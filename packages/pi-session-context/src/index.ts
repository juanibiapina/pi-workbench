import { rename, unlink } from "node:fs/promises";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { AVAILABLE, PROTOCOL, REQUEST, type Broker, type Entry, type RuntimeSnapshot, type SessionRef, type SessionSnapshot } from "./client.ts";
import { Store, contextPathFor, validNamespace } from "./store.ts";

export { Store, contextPathFor } from "./store.ts";
export type Options = { dataDir?: string; pid?: number; now?: () => Date };
function jsonData(value: unknown): unknown {
  const seen = new Set<object>();
  const check = (item: unknown, depth: number): void => {
    if (depth > 32) throw new Error("Pi contribution is too deeply nested");
    if (item === null || typeof item === "string" || typeof item === "boolean") return;
    if (typeof item === "number" && Number.isFinite(item)) return;
    if (!item || typeof item !== "object" || seen.has(item)) throw new Error("Pi contribution must be JSON serializable");
    seen.add(item);
    if (Array.isArray(item)) for (const child of item) check(child, depth + 1);
    else {
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw new Error("Pi contribution must be a plain JSON object");
      for (const child of Object.values(item)) check(child, depth + 1);
    }
    seen.delete(item);
  };
  check(value, 0);
  return structuredClone(value);
}
export function register(pi: ExtensionAPI, options: Options = {}): void {
  const store = new Store(options.dataDir);
  const owners = new Map<string, { token: object; version: number }>();
  const now = options.now ?? (() => new Date());
  const pid = options.pid ?? process.pid;
  let runtime: RuntimeSnapshot | undefined;
  let initialized = false;
  let pending = Promise.resolve();
  const serial = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = pending.then(operation, operation);
    pending = result.then(() => undefined, () => undefined);
    return result;
  };
  const idOf = (ctx: SessionRef) => ctx.sessionManager.getSessionId();
  const fileOf = (ctx: SessionRef) => {
    const file = ctx.sessionManager.getSessionFile();
    if (!file) throw new Error("Current Pi session has no session file");
    return path.resolve(file);
  };
  const ensure = (ctx: SessionRef) => {
    if (!runtime || !initialized) throw new Error("pi-session-context runtime has not started");
    if (idOf(ctx) !== runtime.sessionId) throw new Error("Pi session changed during context operation");
  };
  const owner = (namespace: string, token: object) => {
    if (owners.get(namespace)?.token !== token) throw new Error(`Namespace ${namespace} is not registered by this contributor`);
    return owners.get(namespace)!.version;
  };
  const snapshot = async (ctx: SessionRef) => {
    const file = fileOf(ctx);
    const id = idOf(ctx);
    return store.serialize(file, async () => {
      ensure(ctx);
      const value = await store.readSession(contextPathFor(file, id), id);
      return { ...structuredClone(value), contextPath: contextPathFor(file, id) };
    });
  };
  const mutate = async (ctx: SessionRef, namespace: string, token: object, update: (current: unknown) => unknown) => {
    const file = fileOf(ctx);
    return store.serialize(file, async () => {
      ensure(ctx);
      const version = owner(namespace, token);
      const contextPath = contextPathFor(file, idOf(ctx));
      const current = await store.readSession(contextPath, idOf(ctx));
      const data = jsonData(update(structuredClone(current.extensions[namespace]?.data)));
      const next: SessionSnapshot = { ...current, extensions: { ...current.extensions, [namespace]: { version, data } } };
      await store.saveSession(contextPath, next);
      return structuredClone(next);
    });
  };
  const broker: Broker = {
    protocol: PROTOCOL, active: true,
    register(namespace, token, version) {
      if (!broker.active) throw new Error("pi-session-context provider is stopped");
      if (!validNamespace(namespace) || !Number.isInteger(version) || version < 1) throw new Error(`Invalid contribution namespace or version: ${namespace}`);
      const existing = owners.get(namespace);
      if (existing && (existing.token !== token || existing.version !== version)) throw new Error(`Duplicate namespace: ${namespace}`);
      owners.set(namespace, { token, version });
    },
    getSession: snapshot,
    getRuntime: async (ctx) => {
      ensure(ctx);
      return structuredClone(runtime!);
    },
    updateSession: mutate,
    putRuntime: async (ctx, namespace, token, data) => serial(async () => {
      ensure(ctx);
      const version = owner(namespace, token);
      // Clone before assigning: callers cannot mutate the stored snapshot after the write.
      const item: Entry = { version, data: jsonData(data) };
      const next = { ...runtime!, updatedAt: now().toISOString(), extensions: { ...runtime!.extensions, [namespace]: item } };
      await store.writeRuntime(next);
      runtime = next;
    }),
    clearRuntime: async (ctx, namespace, token) => serial(async () => {
      ensure(ctx); owner(namespace, token);
      const extensions = { ...runtime!.extensions };
      delete extensions[namespace];
      const next = { ...runtime!, updatedAt: now().toISOString(), extensions };
      await store.writeRuntime(next);
      runtime = next;
    }),
    createAttachment: async (ctx, namespace, token, content, update) => {
      const file = fileOf(ctx);
      return store.serialize(file, async () => {
        ensure(ctx);
        const version = owner(namespace, token);
        const contextPath = contextPathFor(file, idOf(ctx));
        const current = await store.readSession(contextPath, idOf(ctx));
        const attachment = await store.createFile(file, content);
        try {
          const data = jsonData(update(structuredClone(current.extensions[namespace]?.data), attachment));
          await store.saveSession(contextPath, { ...current, extensions: { ...current.extensions, [namespace]: { version, data } } });
          return attachment;
        } catch (error) {
          await unlink(attachment.path).catch(() => undefined);
          throw error;
        }
      });
    },
    deleteAttachment: async (ctx, namespace, token, id, update) => {
      const file = fileOf(ctx);
      await store.serialize(file, async () => {
        ensure(ctx);
        const version = owner(namespace, token);
        const contextPath = contextPathFor(file, idOf(ctx));
        const current = await store.readSession(contextPath, idOf(ctx));
        const attachment = store.attachmentPath(file, id);
        const temporary = `${attachment}.${process.pid}.deleting`;
        let moved = false;
        try { await rename(attachment, temporary); moved = true; }
        catch (error) { if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error; }
        try {
          const data = jsonData(update(structuredClone(current.extensions[namespace]?.data)));
          await store.saveSession(contextPath, { ...current, extensions: { ...current.extensions, [namespace]: { version, data } } });
        } catch (error) {
          if (moved) await rename(temporary, attachment);
          throw error;
        }
        if (moved) await unlink(temporary);
      });
    },
  };
  // Probe before installing our listener. Another active provider must own these files.
  let existing = false;
  const probeOff = pi.events.on(AVAILABLE, (value) => { if ((value as Broker)?.active) existing = true; });
  pi.events.emit(REQUEST, null);
  probeOff();
  if (existing) throw new Error("Duplicate pi-session-context provider");
  pi.events.on(REQUEST, () => { if (broker.active) pi.events.emit(AVAILABLE, broker); });
  pi.events.emit(AVAILABLE, broker);

  function base(ctx: ExtensionContext, state: "idle" | "working", previous?: RuntimeSnapshot): RuntimeSnapshot {
    const id = idOf(ctx);
    const sessionFile = ctx.sessionManager.getSessionFile();
    const name = pi.getSessionName();
    return {
      version: 2, sessionId: id, pid, cwd: path.resolve(ctx.cwd),
      ...(name ? { name } : {}),
      ...(sessionFile ? { sessionFile, contextPath: contextPathFor(sessionFile, id) } : {}),
      state, startedAt: previous?.sessionId === id ? previous.startedAt : now().toISOString(),
      updatedAt: now().toISOString(), extensions: previous?.sessionId === id ? previous.extensions : {},
    };
  }
  async function refresh(ctx: ExtensionContext, state?: "idle" | "working") {
    const previous = runtime;
    if (previous && previous.sessionId !== idOf(ctx)) await store.removeRuntime(previous.sessionId);
    const next = base(ctx, state ?? (ctx.isIdle() ? "idle" : "working"), previous);
    if (ctx.sessionManager.getSessionFile()) {
      const file = fileOf(ctx);
      await store.serialize(file, () => store.readSession(contextPathFor(file, idOf(ctx)), idOf(ctx)));
    }
    await store.writeRuntime(next);
    runtime = next;
    initialized = true;
  }
  const on = (event: string, operation: (ctx: ExtensionContext) => Promise<void>) => {
    pi.on(event as "session_start", async (_event, ctx) => serial(() => operation(ctx)));
  };
  const exitHandler = () => { if (runtime) { try { store.removeRuntimeSync(runtime.sessionId); } catch { /* process is exiting */ } } };
  on("session_start", async (ctx) => {
    await refresh(ctx);
    process.off("exit", exitHandler);
    process.once("exit", exitHandler);
  });
  on("session_info_changed", async (ctx) => refresh(ctx, runtime?.state));
  on("agent_start", async (ctx) => refresh(ctx, "working"));
  on("agent_settled", async (ctx) => refresh(ctx, "idle"));
  on("session_shutdown", async () => {
    process.off("exit", exitHandler);
    broker.active = false;
    if (runtime) await store.removeRuntime(runtime.sessionId);
    runtime = undefined;
    initialized = false;
  });

  pi.registerTool({
    name: "get_session_context", label: "Get session context",
    description: "List the current session's namespaced contributions and editable attachment paths.",
    parameters: Type.Object({}),
    async execute(_id, _args, _signal, _update, ctx) {
      const value = await snapshot(ctx);
      const names = Object.keys(value.extensions);
      return { content: [{ type: "text", text: `Session ${value.sessionId} context: ${value.contextPath}\nNamespaces: ${names.join(", ") || "none"}\n${JSON.stringify(value.extensions, null, 2)}` }], details: value };
    },
  });
}
export default register;
