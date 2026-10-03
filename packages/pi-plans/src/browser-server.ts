import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";
import { sendSocketRequest } from "@juanibiapina/pi-socket/client";
import { browserOrigin } from "./browser-url.ts";
import type { PlanDocument, MessageResult, MessageSubmission } from "./browser-contract.ts";

type RecordValue = Record<string, unknown>;
type LocatedPlan = Omit<PlanDocument, "markdown" | "path"> & { file: string };
type Target = { socket: string; sessionId: string };
export type BrowserOptions = { port?: number; roots?: string[]; dataDir?: string; assetsDir: string };
class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
const object = (value: unknown): RecordValue => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object");
  return value as RecordValue;
};
async function jsonFile(file: string): Promise<RecordValue> { return object(JSON.parse(await readFile(file, "utf8"))); }
function isMissing(error: unknown): boolean { return (error as NodeJS.ErrnoException)?.code === "ENOENT"; }

class Plans {
  constructor(private readonly roots: string[], private readonly dataDir: string) {}
  async find(sessionId: string, id: string): Promise<LocatedPlan> {
    const statuses = await this.statuses();
    for (const status of statuses) {
      if (status.sessionId !== sessionId || typeof status.sessionFile !== "string") continue;
      const plan = await this.readPlan(status.sessionFile, sessionId, id);
      if (plan) return plan;
    }
    const walk = async function* (directory: string): AsyncGenerator<string> {
      let entries;
      try { entries = await readdir(directory, { withFileTypes: true }); }
      catch (error) { if (isMissing(error)) return; throw error; }
      for (const entry of entries) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory() && !entry.name.endsWith(".plans")) yield* walk(file);
        else if (entry.isFile() && entry.name.endsWith(".context.json")) yield file.slice(0, -".context.json".length);
      }
    };
    for (const root of this.roots) for await (const file of walk(root)) {
      const plan = await this.readPlan(file, sessionId, id);
      if (plan) return plan;
    }
    throw new HttpError(404, "Plan not found");
  }
  private async readPlan(file: string, sessionId: string, id: string): Promise<LocatedPlan | undefined> {
    try {
      const canonical = await realpath(file);
      const context = await jsonFile(`${canonical}.context.json`);
      if (context.sessionId !== sessionId) return;
      let records: unknown;
      if (context.version === 1) records = context.plans;
      else if (context.version === 2) {
        const contribution = object(object(context.extensions)["pi-plans"]);
        if (contribution.version !== 1) return;
        records = object(contribution.data).plans;
      }
      if (!Array.isArray(records)) return;
      for (const record of records) {
        try {
          const saved = object(record);
          if (saved.id !== id || typeof saved.title !== "string" || typeof saved.path !== "string") continue;
          const attachment = path.resolve(path.dirname(canonical), saved.path);
          if (!(await stat(attachment)).isFile()) continue;
          return { id, title: saved.title, sessionId, file: attachment };
        } catch { /* Skip malformed or missing attachments. */ }
      }
    } catch { /* Keep looking if this context is missing or invalid. */ }
  }
  private async statuses(): Promise<RecordValue[]> {
    let files: string[];
    try { files = await readdir(path.join(this.dataDir, "status")); } catch (error) { if (isMissing(error)) return []; throw error; }
    const statuses: RecordValue[] = [];
    for (const file of files) {
      if (!/^[A-Za-z0-9._-]+\.json$/.test(file)) continue;
      try { const status = await jsonFile(path.join(this.dataDir, "status", file)); if (status.version === 2) statuses.push(status); } catch { /* Stale and invalid statuses are not recipients. */ }
    }
    return statuses;
  }
  async target(plan: LocatedPlan): Promise<Target | undefined> {
    for (const status of await this.statuses()) {
      try {
        if (status.sessionId !== plan.sessionId) continue;
        const socket = object(object(object(status.extensions)["pi-socket"]).data).socketPath;
        if (typeof socket !== "string") continue;
        return { socket, sessionId: plan.sessionId };
      } catch { /* An unreachable socket does not make the plan unreadable. */ }
    }
    return undefined;
  }
  async document(plan: LocatedPlan): Promise<PlanDocument> {
    let markdown: string;
    try { markdown = await readFile(plan.file, "utf8"); } catch { throw new HttpError(404, "Plan is missing"); }
    const { file: _file, ...summary } = plan;
    return { ...summary, markdown, path: plan.file };
  }
}

function validateSubmission(value: unknown): MessageSubmission {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "Expected a message object");
  const message = (value as RecordValue).message;
  if (typeof message !== "string" || !message.trim()) throw new HttpError(400, "Message needs nonempty text");
  return { message };
}

export async function startPlanBrowser(options: BrowserOptions) {
  const dataDir = path.resolve(options.dataDir ?? path.join(homedir(), ".local", "share", "pi"));
  let origin = "";
  const plans = new Plans(options.roots ?? [path.join(homedir(), ".pi", "agent", "sessions")], dataDir);
  const submit = async (plan: LocatedPlan, { message }: MessageSubmission): Promise<MessageResult> => {
    const target = await plans.target(plan);
    if (!target) throw new HttpError(409, "Resume the owning Pi session with pi-socket loaded, then send again.");
    const response = await sendSocketRequest(target.socket, { type: "send_user_message", protocolVersion: 1, expectedSessionId: target.sessionId, message, delivery: "auto" });
    if (response.ok !== true || object(response.result).accepted !== true) throw new HttpError(502, String(response.error && typeof response.error === "object" ? (response.error as RecordValue).message ?? "Pi rejected this message" : "Pi rejected this message"));
    const delivery = object(response.result).delivery as "immediate" | "followUp";
    return { delivery };
  };
  const json = (res: ServerResponse, status: number, value: unknown) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(value)); };
  const server = createServer((req, res) => { void (async () => {
    const url = new URL(req.url ?? "/", origin);
    if (url.pathname.startsWith("/api/")) {
      const match = /^\/api\/plans\/([A-Za-z0-9-]+)\/([a-f0-9]{24})(\/messages)?$/.exec(url.pathname);
      if (match) {
        const plan = await plans.find(match[1]!, match[2]!);
        if (req.method === "GET" && !match[3]) return json(res, 200, await plans.document(plan));
        if (req.method === "POST" && match[3]) {
          const submission = validateSubmission(await requestBody(req));
          return json(res, 200, await submit(plan, submission));
        }
      }
      throw new HttpError(404, "Unknown request");
    }
    if (req.method !== "GET") throw new HttpError(405, "Method not allowed");
    if (!url.pathname.startsWith("/assets/") && !/^\/plans\/[A-Za-z0-9-]+\/[a-f0-9]{24}$/.test(url.pathname)) throw new HttpError(404, "Plan link required");
    const asset = url.pathname.startsWith("/assets/") ? url.pathname.slice(1) : "index.html";
    if (asset !== "index.html" && !/^assets\/[A-Za-z0-9._-]+$/.test(asset)) throw new HttpError(404, "Asset not found");
    const bytes = await readFile(path.join(options.assetsDir, asset));
    const extension = path.extname(asset);
    const mime: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".woff": "font/woff", ".svg": "image/svg+xml" };
    res.writeHead(200, { "Content-Type": mime[extension] ?? "application/octet-stream" }); res.end(bytes);
  })().catch((error: unknown) => { if (!res.headersSent) json(res, error instanceof HttpError ? error.status : 500, { error: error instanceof HttpError ? error.message : "Could not complete this request" }); else res.destroy(); }); });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(options.port ?? 19433, "127.0.0.1", () => { server.off("error", reject); resolve(); }); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing server address");
  origin = browserOrigin(`http://127.0.0.1:${address.port}`);
  return { origin, async close() {
    await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeIdleConnections(); });
  } };
}

async function requestBody(req: IncomingMessage): Promise<unknown> {
  if (!req.headers["content-type"]?.startsWith("application/json")) throw new HttpError(415, "Expected JSON");
  const buffers: Buffer[] = [];
  for await (const chunk of req) buffers.push(Buffer.from(chunk as Buffer));
  try { return JSON.parse(Buffer.concat(buffers).toString("utf8")); } catch { throw new HttpError(400, "Invalid JSON"); }
}
