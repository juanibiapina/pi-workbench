import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { startPlanBrowser } from "../packages/pi-plans/src/browser-server.ts";
import { planUrl } from "../packages/pi-plans/src/browser-url.ts";
import { startSocketServer } from "../packages/pi-socket/src/socket-server.ts";

export async function browserFixture(assetsDir?: string) {
  const root = await mkdtemp("/tmp/pi-review-");
  const sessionFile = path.join(root, "sessions", "session.jsonl");
  await mkdir(path.dirname(sessionFile));
  await writeFile(sessionFile, `${JSON.stringify({ type: "session", id: "session-a", cwd: root })}\n`);
  const id = "0123456789abcdef01234567";
  const markdown = "# Delivery plan\n\nKeep **all plans** together in [one browser](https://example.com).\n\nRepeated phrase.\n\nRepeated phrase.\n\n```ts\nconst count = 3;\n```\n";
  const file = `${sessionFile}.plans/${id}.md`;
  await mkdir(`${sessionFile}.plans`);
  await writeFile(file, markdown);
  await writeFile(`${sessionFile}.context.json`, JSON.stringify({ version: 2, sessionId: "session-a", extensions: { "pi-plans": { version: 1, data: { plans: [{ id, title: "Delivery plan", path: `session.jsonl.plans/${id}.md` }] } } } }));
  await mkdir(path.join(root, "assets"));
  await writeFile(path.join(root, "assets", "index.html"), "<h1>Plans</h1>");
  const messages: Array<{ sessionId: string; message: unknown; options: unknown }> = [];
  let sessionId = "session-a";
  let idle = true;
  const ctx = () => ({ cwd: root, isIdle: () => idle, hasPendingMessages: () => false, sessionManager: { getSessionId: () => sessionId, getSessionFile: () => sessionFile } }) as unknown as ExtensionContext;
  const pi = { getSessionName: () => "Review fixture", sendUserMessage: (message: unknown, options: unknown) => messages.push({ sessionId, message, options }) } as unknown as ExtensionAPI;
  const socket = await startSocketServer({ dataDir: root, pid: process.pid, pi, getContext: ctx, onError: (message) => { throw new Error(message); } });
  await mkdir(path.join(root, "status"));
  await writeFile(path.join(root, "status", "session-a.json"), JSON.stringify({ version: 2, sessionId: "session-a", sessionFile, contextPath: `${sessionFile}.context.json`, cwd: root, name: "Review fixture", extensions: { "pi-socket": { version: 1, data: { socketPath: socket.socketPath } } } }));
  const browser = await startPlanBrowser({ port: 0, roots: [path.join(root, "sessions")], dataDir: root, assetsDir: assetsDir ?? path.join(root, "assets") });
  const request = (url: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(`${browser.origin}${url}`, { method: body ? "POST" : "GET", headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const url = new URL(planUrl("session-a", id, browser.origin)).pathname;
  const endpoint = `/api${url}`;
  return { root, sessionFile, file, id, endpoint, browser, socket, messages, request,
    switchSession: () => { sessionId = "session-b"; }, work: () => { idle = false; },
    async close() { await browser.close(); await socket.close(); await rm(root, { recursive: true, force: true }); } };
}
