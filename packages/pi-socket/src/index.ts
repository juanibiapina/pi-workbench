import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createContributor } from "@juanibiapina/pi-session-context/client";
import { startSocketServer, type SocketServer } from "./socket-server.ts";
import { homedir } from "node:os";
import * as path from "node:path";

export type Options = { dataDir?: string; pid?: number };
export function register(pi: ExtensionAPI, options: Options = {}): void {
  const session = createContributor(pi, "pi-socket");
  let socket: SocketServer | undefined;
  let latest: ExtensionContext | undefined;
  let exit: (() => void) | undefined;
  let queue = Promise.resolve();
  const report = (ctx: ExtensionContext, error: unknown) => {
    const message = `pi-socket: ${String(error)}`;
    if (ctx.hasUI) ctx.ui.notify(message, "error"); else console.error(message);
  };
  async function stop(ctx?: ExtensionContext) {
    if (exit) process.off("exit", exit);
    exit = undefined;
    const old = socket;
    socket = undefined;
    latest = undefined;
    await old?.close();
  }
  async function start(ctx: ExtensionContext) {
    await stop(ctx);
    latest = ctx;
    const created = await startSocketServer({
      dataDir: options.dataDir ?? path.join(homedir(), ".local", "share", "pi"), pid: options.pid ?? process.pid,
      pi, getContext: () => { if (!latest) throw new Error("Pi socket context is unavailable"); return latest; },
      onError: (message) => report(ctx, message),
    });
    try {
      await session.putRuntime(ctx, { socketPath: created.socketPath });
      socket = created;
      exit = () => { try { created.removeFileSync(); } catch { /* process is exiting */ } };
      process.once("exit", exit);
    } catch (error) { await created.close(); throw error; }
  }
  const on = (event: "session_start" | "session_info_changed" | "session_shutdown", operation: (ctx: ExtensionContext) => Promise<void>) => {
    pi.on(event as "session_start", async (_event, ctx) => {
      const result = queue.then(() => operation(ctx), () => operation(ctx));
      queue = result.catch((error) => report(ctx, error));
      await result;
    });
  };
  on("session_start", start);
  on("session_info_changed", async (ctx) => {
    latest = ctx;
    if (socket) await session.putRuntime(ctx, { socketPath: socket.socketPath });
  });
  on("session_shutdown", stop);
}
export default register;
