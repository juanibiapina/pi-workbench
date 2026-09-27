import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const REQUEST = "juanibiapina:pi-session-context:v1:request";
export const AVAILABLE = "juanibiapina:pi-session-context:v1:available";
export const PROTOCOL = 1;
export type Entry = { version: number; data: unknown };
export type SessionSnapshot = { version: 2; sessionId: string; extensions: Record<string, Entry> };
export type RuntimeSnapshot = SessionSnapshot & {
  pid: number; cwd: string; name?: string; sessionFile?: string; contextPath?: string;
  state: "idle" | "working"; startedAt: string; updatedAt: string;
};
export type Attachment = { id: string; path: string };
export type SessionRef = Pick<ExtensionContext, "sessionManager">;
export type Broker = {
  protocol: typeof PROTOCOL;
  active: boolean;
  register(namespace: string, token: object, version: number): void;
  getSession(ctx: SessionRef): Promise<SessionSnapshot & { contextPath: string }>;
  getRuntime(ctx: SessionRef): Promise<RuntimeSnapshot>;
  updateSession(ctx: SessionRef, namespace: string, token: object, update: (current: unknown) => unknown): Promise<SessionSnapshot>;
  putRuntime(ctx: SessionRef, namespace: string, token: object, data: unknown): Promise<void>;
  clearRuntime(ctx: SessionRef, namespace: string, token: object): Promise<void>;
  createAttachment(ctx: SessionRef, namespace: string, token: object, content: string, update: (current: unknown, attachment: Attachment) => unknown): Promise<Attachment>;
  deleteAttachment(ctx: SessionRef, namespace: string, token: object, id: string, update: (current: unknown) => unknown): Promise<void>;
};

export async function discover(pi: ExtensionAPI, timeoutMs = 500): Promise<Broker> {
  return new Promise((resolve, reject) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (broker?: Broker, error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      off();
      if (broker) resolve(broker);
      else reject(error ?? new Error("pi-session-context provider is unavailable"));
    };
    const off = pi.events.on(AVAILABLE, (value) => {
      const candidate = value as Broker;
      if (!candidate || candidate.protocol !== PROTOCOL) {
        finish(undefined, new Error("Incompatible pi-session-context broker protocol"));
      } else if (candidate.active) finish(candidate);
    });
    timer = setTimeout(() => finish(), timeoutMs);
    pi.events.emit(REQUEST, null);
  });
}

export function createContributor(pi: ExtensionAPI, namespace: string, version = 1) {
  const token = {};
  let registered: Broker | undefined;
  const broker = async () => {
    const current = await discover(pi);
    if (registered !== current) {
      current.register(namespace, token, version);
      registered = current;
    }
    return current;
  };
  return {
    getSession: async (ctx: SessionRef) => (await broker()).getSession(ctx),
    getRuntime: async (ctx: SessionRef) => (await broker()).getRuntime(ctx),
    updateSession: async (ctx: SessionRef, update: (current: unknown) => unknown) =>
      (await broker()).updateSession(ctx, namespace, token, update),
    putSession: async (ctx: SessionRef, data: unknown) =>
      (await broker()).updateSession(ctx, namespace, token, () => data),
    putRuntime: async (ctx: SessionRef, data: unknown) => (await broker()).putRuntime(ctx, namespace, token, data),
    clearRuntime: async (ctx: SessionRef) => (await broker()).clearRuntime(ctx, namespace, token),
    createAttachment: async (ctx: SessionRef, content: string, update: (current: unknown, attachment: Attachment) => unknown) =>
      (await broker()).createAttachment(ctx, namespace, token, content, update),
    deleteAttachment: async (ctx: SessionRef, id: string, update: (current: unknown) => unknown) =>
      (await broker()).deleteAttachment(ctx, namespace, token, id, update),
  };
}
