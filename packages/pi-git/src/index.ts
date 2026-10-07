import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPushDetector, currentBranch, type GitPush, type PushDetector } from "./detector.ts";

export { createPushDetector, type GitPush, type PushDetector } from "./detector.ts";

export const PUSH_EVENT = "juanibiapina:pi-git:v1:push";

export interface PushEvent extends GitPush {
  source: "agent" | "external";
}

type Source = PushEvent["source"];

export function register(pi: ExtensionAPI): void {
  let detector: Promise<PushDetector> | undefined;
  let cwd = "";
  let running: Promise<void> | undefined;
  let queued: Source | undefined;
  const emit = async (source: Source) => {
    const active = detector;
    if (!active) return;
    const pushes = await (await active).check();
    const branch = source === "external" && pushes.length ? await currentBranch(cwd) : null;
    for (const push of pushes) {
      if (source === "external" && push.branch !== branch) continue;
      if (detector === active) pi.events.emit(PUSH_EVENT, { ...push, source } satisfies PushEvent);
    }
  };
  const check = (source: Source): Promise<void> => {
    if (running) {
      queued = queued === "agent" || source === "agent" ? "agent" : "external";
      return running;
    }
    running = (async () => {
      let next: Source | undefined = source;
      while (next) {
        queued = undefined;
        await emit(next).catch(() => undefined);
        next = queued;
      }
      running = undefined;
    })();
    return running;
  };
  pi.on("session_start", async (_event, ctx) => {
    cwd = ctx.cwd;
    detector = createPushDetector({ cwd });
    await detector;
  });
  pi.on("tool_execution_end", () => { void check("agent"); });
  pi.on("before_agent_start", async () => { await check("external"); });
  pi.on("session_shutdown", () => { detector = undefined; });
}

export default register;
