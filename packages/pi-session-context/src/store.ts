import { randomBytes } from "node:crypto";
import { unlinkSync } from "node:fs";
import { chmod, copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";
import type { Entry, RuntimeSnapshot, SessionSnapshot } from "./client.ts";

const validId = (id: string) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id);
const validNamespace = (name: string) => /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(name) && name.length <= 100;
const validPlanId = (id: string) => /^[a-f0-9]{24}$/.test(id);
export { validNamespace };
export const defaultDataDir = () => path.join(homedir(), ".local", "share", "pi");
export function contextPathFor(sessionFile: string, sessionId: string): string {
  if (!validId(sessionId)) throw new Error(`Invalid Pi session ID: ${sessionId}`);
  return `${path.resolve(sessionFile)}.context.json`;
}
const statusPath = (dir: string, id: string) => {
  if (!validId(id)) throw new Error(`Invalid Pi session ID: ${id}`);
  return path.join(dir, "status", `${id}.json`);
};
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === "ENOENT";
async function atomic(file: string, value: unknown): Promise<void> {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(text) > 1024 * 1024) throw new Error("Pi context exceeds 1 MiB");
  const temporary = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, text, { mode: 0o600, flag: "wx" });
    await rename(temporary, file);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}
function entry(data: unknown): Entry {
  return { version: 1, data };
}
function validate(snapshot: unknown, id: string): SessionSnapshot {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw new Error("Invalid Pi session context");
  const value = snapshot as SessionSnapshot;
  if (value.version !== 2 || value.sessionId !== id || !value.extensions ||
      typeof value.extensions !== "object" || Array.isArray(value.extensions)) throw new Error("Invalid Pi session context");
  for (const [name, item] of Object.entries(value.extensions)) {
    if (!validNamespace(name) || !item || !Number.isInteger(item.version) || item.version < 1 ||
        !("data" in item)) throw new Error(`Invalid Pi session namespace: ${name}`);
  }
  return value;
}
function migrate(old: Record<string, unknown>, id: string): SessionSnapshot {
  if (old.version !== 1 || old.sessionId !== id || !Array.isArray(old.plans) ||
      (old.pullRequests !== undefined && !Array.isArray(old.pullRequests)) ||
      (old.skills !== undefined && !Array.isArray(old.skills))) throw new Error("Invalid legacy Pi session context");
  for (const plan of old.plans) {
    if (!plan || typeof plan !== "object" || !validPlanId(plan.id) || typeof plan.title !== "string" ||
        typeof plan.path !== "string" || !plan.path.endsWith(`.plans/${plan.id}.md`)) throw new Error("Invalid legacy plan");
  }
  const extensions: Record<string, Entry> = {};
  if (old.plans.length) extensions["pi-plans"] = entry({ plans: old.plans });
  if ((old.pullRequests as unknown[] | undefined)?.length) extensions["pi-github"] = entry({ pullRequests: old.pullRequests });
  if ((old.skills as unknown[] | undefined)?.length || old.skillPaths) extensions["pi-skills"] = entry({ skills: old.skills ?? [], skillPaths: old.skillPaths ?? {} });
  return { version: 2, sessionId: id, extensions };
}
export class Store {
  private queues = new Map<string, Promise<void>>();
  constructor(readonly dataDir = defaultDataDir()) {}
  serialize<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const settled = result.then(() => undefined, () => undefined);
    this.queues.set(key, settled);
    void settled.then(() => { if (this.queues.get(key) === settled) this.queues.delete(key); });
    return result;
  }
  async readSession(file: string, id: string): Promise<SessionSnapshot> {
    let text: string;
    try { text = await readFile(file, "utf8"); }
    catch (error) {
      if (!missing(error)) throw error;
      const empty: SessionSnapshot = { version: 2, sessionId: id, extensions: {} };
      try { await writeFile(file, `${JSON.stringify(empty, null, 2)}\n`, { mode: 0o600, flag: "wx" }); }
      catch (creationError) { if ((creationError as NodeJS.ErrnoException)?.code !== "EEXIST") throw creationError; }
      text = await readFile(file, "utf8");
    }
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { throw new Error(`Could not read Pi session context ${file}`); }
    if ((parsed as {version?: number})?.version === 1) {
      const updated = validate(migrate(parsed as Record<string, unknown>, id), id);
      const backup = `${file}.v1.bak`;
      try { await copyFile(file, backup, 1); }
      catch (error) { if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") throw error; }
      await atomic(file, updated);
      return updated;
    }
    return validate(parsed, id);
  }
  async saveSession(file: string, value: SessionSnapshot): Promise<void> {
    validate(value, value.sessionId);
    await atomic(file, value);
  }
  async writeRuntime(value: RuntimeSnapshot): Promise<void> {
    if (!validId(value.sessionId) || value.version !== 2 || (value.state !== "idle" && value.state !== "working"))
      throw new Error("Invalid Pi runtime status");
    const dir = path.join(this.dataDir, "status");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700);
    await atomic(statusPath(this.dataDir, value.sessionId), value);
  }
  async removeRuntime(id: string): Promise<void> {
    await unlink(statusPath(this.dataDir, id)).catch((error: unknown) => { if (!missing(error)) throw error; });
  }
  removeRuntimeSync(id: string): void {
    try { unlinkSync(statusPath(this.dataDir, id)); }
    catch (error) { if (!missing(error)) throw error; }
  }
  attachmentDir(sessionFile: string): string { return `${path.resolve(sessionFile)}.plans`; }
  async createFile(sessionFile: string, content: string): Promise<{ id: string; path: string }> {
    if (!content.trim() || Buffer.byteLength(content, "utf8") > 256 * 1024) throw new Error("Attachment must contain 1–262144 bytes");
    const dir = this.attachmentDir(sessionFile);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700);
    for (;;) {
      const id = randomBytes(12).toString("hex");
      const file = path.join(dir, `${id}.md`);
      try { await writeFile(file, content, { mode: 0o600, flag: "wx" }); return { id, path: file }; }
      catch (error) { if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") throw error; }
    }
  }
  attachmentPath(sessionFile: string, id: string): string {
    if (!validPlanId(id)) throw new Error(`Invalid attachment ID: ${id}`);
    return path.join(this.attachmentDir(sessionFile), `${id}.md`);
  }
}
