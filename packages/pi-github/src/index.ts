import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { createContributor } from "@juanibiapina/pi-session-context/client";

function canonical(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error(`Invalid GitHub PR URL: ${value}`); }
  if (url.origin !== "https://github.com" || url.username || url.password ||
      !/^\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/pull\/[1-9][0-9]*\/?$/.test(url.pathname)) throw new Error(`Invalid GitHub PR URL: ${value}`);
  return `https://github.com${url.pathname.replace(/\/$/, "")}`;
}
function requests(current: unknown): string[] {
  if (current === undefined) return [];
  const data = current as { pullRequests?: unknown };
  if (!data || !Array.isArray(data.pullRequests) || !data.pullRequests.every((url) => typeof url === "string")) throw new Error("Invalid saved pull requests");
  return data.pullRequests;
}
export function register(pi: ExtensionAPI): void {
  const session = createContributor(pi, "pi-github");
  pi.registerTool({
    name: "save_pr", label: "Save PR",
    description: "Associate a GitHub pull request with the current Pi session. Call after opening a PR for work in this session, or when the user gives you a PR associated with this session. Accepts its GitHub PR URL and saves it once.",
    promptSnippet: "After opening a PR for this session or receiving an associated PR URL, call save_pr with its URL",
    parameters: Type.Object({ url: Type.String() }),
    async execute(_id, { url }, _signal, _update, ctx) {
      const pullRequest = canonical(url);
      await session.updateSession(ctx, (current) => {
        const saved = requests(current);
        return { pullRequests: saved.includes(pullRequest) ? saved : [...saved, pullRequest] };
      });
      return { content: [{ type: "text", text: `Saved PR ${pullRequest} to session context.` }], details: { sessionId: ctx.sessionManager.getSessionId(), pullRequest } };
    },
  });
  pi.registerTool({
    name: "remove_pr", label: "Remove PR",
    description: "Remove a GitHub pull request association from the current Pi session. Call when a PR should no longer be associated with this session.",
    parameters: Type.Object({ url: Type.String() }),
    async execute(_id, { url }, _signal, _update, ctx) {
      const pullRequest = canonical(url);
      await session.updateSession(ctx, (current) => {
        const saved = requests(current);
        if (!saved.includes(pullRequest)) throw new Error(`PR not found in this session: ${pullRequest}`);
        return { pullRequests: saved.filter((item) => item !== pullRequest) };
      });
      return { content: [{ type: "text", text: `Removed PR ${pullRequest} from session context.` }], details: { sessionId: ctx.sessionManager.getSessionId(), pullRequest } };
    },
  });
}
export default register;
