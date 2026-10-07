import { Type } from "@sinclair/typebox";
import { Box, getCapabilities, hyperlink, Spacer, Text, TruncatedText } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { PUSH_EVENT, type PushEvent } from "@juanibiapina/pi-git";
import { createContributor } from "@juanibiapina/pi-session-context/client";
import { createGhAdapter, type GitHub } from "./github.ts";
import { createTracker, type BuildFailure, type Tracker } from "./tracker.ts";

export { createTracker, normalize, type Build, type BuildFailure, type GithubSession, type SessionData, type Tracker } from "./tracker.ts";
export { createGhAdapter, parseRemoteUrl, summarize, type Checks, type GitHub, type PullRequest } from "./github.ts";

export const BUILD_FAILURE_MESSAGE = "pi-github-build-failure";

const failedRuns = (build: BuildFailure["build"]) => build.checks?.runs.filter((run) => run.state === "failure") ?? [];
const linkUrl = (label: string, url: string) => url && getCapabilities().hyperlinks ? hyperlink(label, url) : label;

function describeFailure({ build, pullRequest }: BuildFailure): string {
  const failed = failedRuns(build);
  return [
    `The build failed for ${build.repository} branch ${build.branch} at commit ${build.sha.slice(0, 7)}, pushed in this session${pullRequest ? ` (PR ${pullRequest.url})` : ""}.`,
    "Failed checks:",
    ...failed.map((run) => run.url ? `- ${run.name}: ${run.url}` : `- ${run.name}`),
  ].join("\n");
}

function canonical(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error(`Invalid GitHub PR URL: ${value}`); }
  if (url.origin !== "https://github.com" || url.username || url.password ||
      !/^\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/pull\/[1-9][0-9]*\/?$/.test(url.pathname)) throw new Error(`Invalid GitHub PR URL: ${value}`);
  return `https://github.com${url.pathname.replace(/\/$/, "")}`;
}
function prLabel(value: string | undefined): string {
  if (!value) return "…";
  try {
    const url = new URL(value);
    if (url.hostname === "github.com" && /^\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/pull\/[1-9][0-9]*\/?$/.test(url.pathname)) {
      const [owner, repo, , number] = url.pathname.split("/").filter(Boolean);
      return `${owner}/${repo}#${number}`;
    }
  } catch { return value; }
  return value;
}
function linkPr(label: string, value: string | undefined): string {
  if (!value || !getCapabilities().hyperlinks) return label;
  try { return hyperlink(label, canonical(value)); } catch { return label; }
}
const resultText = (result: { content: Array<{ type: string; text?: string }> }) =>
  result.content.find((item) => item.type === "text")?.text ?? "Operation failed";
export interface Options {
  github?: GitHub;
  pollIntervalMs?: number;
  idleTimeoutMs?: number;
}

const REFRESH_INTERVAL_MS = 60_000;

export function register(pi: ExtensionAPI, options: Options = {}): void {
  const session = createContributor(pi, "pi-github");
  const github = options.github ?? createGhAdapter(pi);
  let tracker: Tracker | undefined;
  let lastRefresh = 0;
  const start = (ctx: ExtensionContext): Tracker => {
    tracker?.stop();
    tracker = createTracker({
      github, pollIntervalMs: options.pollIntervalMs, idleTimeoutMs: options.idleTimeoutMs,
      onBuildFailure: (failure) => {
        pi.sendMessage({ customType: BUILD_FAILURE_MESSAGE, content: describeFailure(failure), display: true, details: failure });
      },
      session: {
        read: async () => (await session.getSession(ctx)).extensions["pi-github"]?.data,
        update: async (change) => (await session.updateSession(ctx, change)).extensions["pi-github"]?.data,
      },
    });
    return tracker;
  };
  const refresh = (active: Tracker) => {
    lastRefresh = Date.now();
    active.refresh().catch(() => undefined);
  };
  pi.registerMessageRenderer<BuildFailure>(BUILD_FAILURE_MESSAGE, (message, { expanded, outputPad }, theme) => {
    if (!message.details) return undefined;
    const { build, pullRequest } = message.details;
    const box = new Box(outputPad, 0);
    box.addChild(new TruncatedText(theme.fg("error", theme.bold("✗ Build failed ")) +
      theme.fg("accent", `${build.repository} ${build.branch}`) + theme.fg("dim", ` ${build.sha.slice(0, 7)}`) +
      (pullRequest ? " " + linkPr(theme.fg("accent", prLabel(pullRequest.url)), pullRequest.url) : "")));
    if (expanded) {
      for (const run of failedRuns(build)) box.addChild(new TruncatedText(theme.fg("toolOutput", "  ") + linkUrl(theme.fg("error", run.name), run.url)));
    }
    return box;
  });
  pi.on("session_start", (_event, ctx) => { refresh(start(ctx)); });
  pi.on("before_agent_start", () => {
    if (!tracker) return;
    tracker.touch();
    if (Date.now() - lastRefresh >= REFRESH_INTERVAL_MS) refresh(tracker);
  });
  pi.on("tool_execution_end", () => { tracker?.touch(); });
  pi.on("agent_end", () => { tracker?.touch(); });
  pi.on("session_shutdown", () => {
    tracker?.stop();
    tracker = undefined;
  });
  pi.events.on(PUSH_EVENT, (push) => { tracker?.recordPush(push as PushEvent).catch(() => undefined); });
  pi.registerTool({
    name: "save_pr", label: "Save PR",
    description: "Associate a GitHub pull request that this session did not push, such as a URL the user gives. Pushed branches and their PRs are tracked automatically.",
    parameters: Type.Object({ url: Type.String() }),
    async execute(_id, { url }, _signal, _update, ctx) {
      const pullRequest = canonical(url);
      await (tracker ?? start(ctx)).trackPullRequest(pullRequest);
      return { content: [{ type: "text", text: `Saved PR ${pullRequest} to session context.` }], details: { sessionId: ctx.sessionManager.getSessionId(), pullRequest } };
    },
    renderCall(args, theme) {
      return new TruncatedText(theme.fg("toolTitle", theme.bold("save_pr ")) + linkPr(theme.fg("accent", prLabel(args?.url)), args?.url));
    },
    renderResult(result, { expanded, isPartial }, theme, context) {
      if (context.isError) return new Text(theme.fg("error", resultText(result)), 0, 0);
      if (!expanded) return new Spacer(0);
      if (isPartial) return new Text(theme.fg("warning", "Saving PR…"), 0, 0);
      const url = (result.details as { pullRequest?: string } | undefined)?.pullRequest;
      if (!url) return new TruncatedText(theme.fg("toolOutput", resultText(result)));
      return new Text(linkPr(theme.fg("accent", url), url), 0, 0);
    },
  });
  pi.registerTool({
    name: "remove_pr", label: "Remove PR",
    description: "Remove a GitHub pull request association from the current Pi session. Call when a PR should no longer be associated with this session.",
    parameters: Type.Object({ url: Type.String() }),
    async execute(_id, { url }, _signal, _update, ctx) {
      const pullRequest = canonical(url);
      await (tracker ?? start(ctx)).untrackPullRequest(pullRequest);
      return { content: [{ type: "text", text: `Removed PR ${pullRequest} from session context.` }], details: { sessionId: ctx.sessionManager.getSessionId(), pullRequest } };
    },
    renderCall(args, theme) {
      return new TruncatedText(theme.fg("toolTitle", theme.bold("remove_pr ")) + linkPr(theme.fg("accent", prLabel(args?.url)), args?.url));
    },
    renderResult(result, { expanded, isPartial }, theme, context) {
      if (context.isError) return new Text(theme.fg("error", resultText(result)), 0, 0);
      if (!expanded) return new Spacer(0);
      if (isPartial) return new Text(theme.fg("warning", "Removing PR…"), 0, 0);
      const url = (result.details as { pullRequest?: string } | undefined)?.pullRequest;
      if (!url) return new TruncatedText(theme.fg("toolOutput", resultText(result)));
      return new Text(linkPr(theme.fg("accent", url), url), 0, 0);
    },
  });
}
export default register;
