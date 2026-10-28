import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPushDetector, type GitPush, type PushDetector } from "./detector.ts";

export { createPushDetector, type GitPush, type PushDetector } from "./detector.ts";

export const PUSH_EVENT = "juanibiapina:pi-git:v1:push";

export type PushEvent = GitPush;

const PUSH_COMMAND = /\bpush\b|\bgh\s+pr\s+create\b|\bbut\s+pr\b/;

const pushes = (toolName: string, args: unknown) => {
  const command = (args as { command?: unknown } | undefined)?.command;
  return toolName === "bash" && typeof command === "string" && PUSH_COMMAND.test(command);
};

export function register(pi: ExtensionAPI): void {
  let detector: Promise<PushDetector> | undefined;
  let open = new Set<string>();
  let queue: Promise<void> = Promise.resolve();
  const observe = (change: (windows: Set<string>) => void): Promise<void> => {
    const active = detector;
    const windows = open;
    if (!active) return Promise.resolve();
    const run = async () => {
      const found = await (await active).check().catch(() => []);
      const claimed = windows.size > 0;
      change(windows);
      if (!claimed || detector !== active) return;
      for (const push of found) pi.events.emit(PUSH_EVENT, push satisfies PushEvent);
    };
    queue = queue.then(run, run);
    return queue;
  };
  pi.on("session_start", async (_event, ctx) => {
    open = new Set();
    detector = createPushDetector({ cwd: ctx.cwd });
    await detector;
  });
  pi.on("tool_execution_start", async (event) => {
    if (pushes(event.toolName, event.args)) await observe((windows) => windows.add(event.toolCallId));
  });
  pi.on("tool_execution_end", async (event) => {
    if (open.has(event.toolCallId)) await observe((windows) => windows.delete(event.toolCallId));
  });
  pi.on("session_shutdown", () => { detector = undefined; });
}

export default register;
