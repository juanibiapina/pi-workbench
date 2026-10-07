import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PushEvent } from "../packages/pi-git/src/index.ts";
import { createTracker, summarize, type Checks, type GitHub, type PullRequestView, type TrackedBranch } from "../packages/pi-github/src/index.ts";
import { createContributor } from "../packages/pi-session-context/src/client.ts";
import { register as provider } from "../packages/pi-session-context/src/index.ts";

const repository = "o/r";
const pr = (number: number, branch: string, headSha: string, state: "open" | "merged" = "open"): PullRequestView => ({
  repository, branch, headSha, pullRequest: { number, url: `https://github.com/o/r/pull/${number}`, title: `PR ${number}`, state },
});
const run = (state: "pending" | "success" | "failure") => [{ name: "check", state, url: "https://example.com/run" }];

function fakeGitHub() {
  const pulls = new Map<string, PullRequestView>();
  const checks = new Map<string, Array<Checks["runs"]>>();
  let failing = false;
  const github: GitHub = {
    async findPullRequest(_repo, branch) {
      if (failing) throw new Error("offline");
      return [...pulls.values()].find((item) => item.branch === branch) ?? null;
    },
    async viewPullRequest(url) {
      if (failing) throw new Error("offline");
      const found = [...pulls.values()].find((item) => item.pullRequest.url === url);
      if (!found) throw new Error("not found");
      return found;
    },
    async readChecks(_repo, sha) {
      if (failing) throw new Error("offline");
      const sequence = checks.get(sha) ?? [[]];
      const runs = sequence.length > 1 ? sequence.shift()! : sequence[0]!;
      return summarize(sha, runs, new Date().toISOString());
    },
  };
  return { github, pulls, checks, setFailing: (value: boolean) => { failing = value; } };
}

async function session(options: { pollIntervalMs?: number; idleTimeoutMs?: number; now?: () => number } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "pi-github-"));
  const emitter = new EventEmitter();
  const handlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => unknown>>();
  const pi = {
    events: { emit: (name: string, value: unknown) => emitter.emit(name, value), on: (name: string, handler: (value: unknown) => void) => { emitter.on(name, handler); return () => emitter.off(name, handler); } },
    on: (name: string, handler: any) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
    registerTool: () => {}, getSessionName: () => "Test",
  } as unknown as ExtensionAPI;
  const ctx = { cwd: dir, hasUI: false, isIdle: () => true, sessionManager: { getSessionId: () => "s", getSessionFile: () => path.join(dir, "s.jsonl") } } as ExtensionContext;
  provider(pi, { dataDir: dir });
  const contributor = createContributor(pi, "pi-github", 2);
  const fake = fakeGitHub();
  const start = async () => { for (const handler of handlers.get("session_start") ?? []) await handler({ type: "session_start" }, ctx); };
  const tracker = createTracker({
    github: fake.github, ...options,
    session: {
      read: async () => (await contributor.getSession(ctx)).extensions["pi-github"]?.data,
      update: async (change) => (await contributor.updateSession(ctx, change)).extensions["pi-github"]?.data,
    },
  });
  const branches = async () => ((await contributor.getSession(ctx)).extensions["pi-github"]?.data as { branches?: TrackedBranch[] } | undefined)?.branches ?? [];
  const close = async () => {
    tracker.stop();
    for (const handler of handlers.get("session_shutdown") ?? []) await handler({ type: "session_shutdown" }, ctx);
    await rm(dir, { recursive: true, force: true });
  };
  return { dir, tracker, fake, branches, start, close };
}

const push = (branch: string, after: string, remoteUrl = "git@github.com:o/r.git", pushedAt = Date.parse("2026-01-01T00:00:00Z")): PushEvent => ({
  repository: "/work", remote: "origin", remoteUrl, branch, before: null, after, pushedAt, source: "agent",
});

async function until(condition: () => Promise<boolean>, timeoutMs = 2000) {
  const end = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > end) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("a pushed branch records its pull request and build status", async () => {
  const s = await session();
  try {
    await s.start();
    s.fake.pulls.set("feature", pr(7, "feature", "abc"));
    s.fake.checks.set("abc", [run("success")]);
    await s.tracker.recordPush(push("feature", "abc"));
    const [entry] = await s.branches();
    assert.equal(entry!.branch, "feature");
    assert.deepEqual(entry!.head, { sha: "abc", pushedAt: "2026-01-01T00:00:00.000Z", source: "agent" });
    assert.equal(entry!.pullRequest?.number, 7);
    assert.equal(entry!.checks?.state, "success");
  } finally { await s.close(); }
});

test("a push to main records build status without a pull request", async () => {
  const s = await session();
  try {
    await s.start();
    s.fake.checks.set("m1", [run("failure")]);
    await s.tracker.recordPush(push("main", "m1", "https://github.com/o/r.git"));
    const [entry] = await s.branches();
    assert.equal(entry!.pullRequest, null);
    assert.equal(entry!.checks?.state, "failure");
  } finally { await s.close(); }
});

test("pushes to remotes outside GitHub are not tracked", async () => {
  const s = await session();
  try {
    await s.start();
    await s.tracker.recordPush(push("main", "m1", "https://gitlab.com/o/r.git"));
    assert.deepEqual(await s.branches(), []);
  } finally { await s.close(); }
});

test("pending builds are polled until they finish", async () => {
  const s = await session({ pollIntervalMs: 10 });
  try {
    await s.start();
    s.fake.checks.set("abc", [run("pending"), run("pending"), run("success")]);
    await s.tracker.recordPush(push("feature", "abc"));
    assert.equal((await s.branches())[0]!.checks?.state, "pending");
    await until(async () => (await s.branches())[0]!.checks?.state === "success");
  } finally { await s.close(); }
});

test("a fresh push is polled until GitHub registers its builds", async () => {
  const s = await session({ pollIntervalMs: 10 });
  try {
    await s.start();
    s.fake.checks.set("abc", [[], [], run("success")]);
    await s.tracker.recordPush(push("feature", "abc", undefined, Date.now()));
    assert.equal((await s.branches())[0]!.checks?.state, "none");
    await until(async () => (await s.branches())[0]!.checks?.state === "success");
  } finally { await s.close(); }
});

test("a new push replaces the build status of the previous commit", async () => {
  const s = await session();
  try {
    await s.start();
    s.fake.checks.set("abc", [run("failure")]);
    await s.tracker.recordPush(push("feature", "abc"));
    s.fake.setFailing(true);
    await s.tracker.recordPush(push("feature", "def"));
    const [entry] = await s.branches();
    assert.equal(entry!.head?.sha, "def");
    assert.equal(entry!.checks, null);
  } finally { await s.close(); }
});

test("polling pauses after inactivity and resumes on activity", async () => {
  let clock = 0;
  const s = await session({ pollIntervalMs: 10, idleTimeoutMs: 1000, now: () => clock });
  try {
    await s.start();
    s.fake.checks.set("abc", [run("pending"), run("success")]);
    await s.tracker.recordPush(push("feature", "abc"));
    clock = 5000;
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal((await s.branches())[0]!.checks?.state, "pending");
    s.tracker.touch();
    await until(async () => (await s.branches())[0]!.checks?.state === "success");
  } finally { await s.close(); }
});

test("GitHub errors keep the last known data until a refresh succeeds", async () => {
  const s = await session();
  try {
    await s.start();
    s.fake.pulls.set("feature", pr(7, "feature", "abc"));
    await s.tracker.recordPush(push("feature", "abc"));
    s.fake.setFailing(true);
    await s.tracker.refresh();
    assert.equal((await s.branches())[0]!.pullRequest?.state, "open");
    s.fake.setFailing(false);
    s.fake.pulls.set("feature", pr(7, "feature", "abc", "merged"));
    await s.tracker.refresh();
    assert.equal((await s.branches())[0]!.pullRequest?.state, "merged");
  } finally { await s.close(); }
});

test("saved pull request URLs from older sessions gain their branch on refresh", async () => {
  const s = await session();
  try {
    await writeFile(path.join(s.dir, "s.jsonl.context.json"), JSON.stringify({
      version: 2, sessionId: "s", extensions: { "pi-github": { version: 1, data: { pullRequests: ["https://github.com/o/r/pull/3"] } } },
    }));
    await s.start();
    s.fake.pulls.set("old", pr(3, "old", "def"));
    s.fake.checks.set("def", [run("success")]);
    await s.tracker.refresh();
    const [entry] = await s.branches();
    assert.equal(entry!.branch, "old");
    assert.equal(entry!.pullRequest?.title, "PR 3");
    assert.equal(entry!.checks?.state, "success");
  } finally { await s.close(); }
});

test("a pull request saved by URL is tracked with its branch and builds, and can be removed", async () => {
  const s = await session();
  try {
    await s.start();
    s.fake.pulls.set("given", pr(9, "given", "ghi"));
    s.fake.checks.set("ghi", [run("success")]);
    const entry = await s.tracker.trackPullRequest("https://github.com/o/r/pull/9");
    assert.equal(entry.branch, "given");
    assert.equal(entry.checks?.state, "success");
    await s.tracker.recordPush(push("given", "jkl"));
    assert.equal((await s.branches()).length, 1);
    await s.tracker.untrackPullRequest("https://github.com/o/r/pull/9");
    assert.deepEqual(await s.branches(), []);
    await assert.rejects(s.tracker.untrackPullRequest("https://github.com/o/r/pull/9"), /PR not found/);
  } finally { await s.close(); }
});

test("a stopped tracker writes nothing", async () => {
  const s = await session();
  try {
    await s.start();
    s.tracker.stop();
    await s.tracker.recordPush(push("feature", "abc"));
    assert.deepEqual(await s.branches(), []);
  } finally { await s.close(); }
});
