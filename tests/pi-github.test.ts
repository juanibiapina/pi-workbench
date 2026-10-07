import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { PUSH_EVENT, type PushEvent } from "../packages/pi-git/src/index.ts";
import { createTracker, register, summarize, type Build, type BuildFailure, type Checks, type GitHub, type PullRequest } from "../packages/pi-github/src/index.ts";
import { createContributor } from "../packages/pi-session-context/src/client.ts";
import { register as provider } from "../packages/pi-session-context/src/index.ts";

const repository = "o/r";
const pr = (number: number, branch: string, state: "open" | "merged" = "open"): PullRequest => ({
  repository, number, url: `https://github.com/o/r/pull/${number}`, branch, title: `PR ${number}`, state,
});
const run = (state: "pending" | "success" | "failure") => [{ name: "check", state, url: "https://example.com/run" }];

function fakeGitHub() {
  const pulls = new Map<string, PullRequest>();
  const checks = new Map<string, Array<Checks["runs"]>>();
  let failing = false;
  const github: GitHub = {
    async findPullRequest(_repo, branch) {
      if (failing) throw new Error("offline");
      return [...pulls.values()].find((item) => item.branch === branch) ?? null;
    },
    async viewPullRequest(url) {
      if (failing) throw new Error("offline");
      const found = [...pulls.values()].find((item) => item.url === url);
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

function harness(dir: string) {
  const emitter = new EventEmitter();
  const handlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => unknown>>();
  const messages: Array<{ customType: string; content: unknown; display: boolean }> = [];
  const pi = {
    events: { emit: (name: string, value: unknown) => emitter.emit(name, value), on: (name: string, handler: (value: unknown) => void) => { emitter.on(name, handler); return () => emitter.off(name, handler); } },
    on: (name: string, handler: any) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
    registerTool: () => {}, registerMessageRenderer: () => {}, getSessionName: () => "Test",
    sendMessage: (message: { customType: string; content: unknown; display: boolean }) => { messages.push(message); },
  } as unknown as ExtensionAPI;
  const ctx = { cwd: dir, hasUI: false, isIdle: () => true, sessionManager: { getSessionId: () => "s", getSessionFile: () => path.join(dir, "s.jsonl") } } as ExtensionContext;
  const emit = async (name: string) => { for (const handler of handlers.get(name) ?? []) await handler({ type: name }, ctx); };
  provider(pi, { dataDir: dir });
  return { pi, ctx, emit, emitter, messages };
}

type Options = { pollIntervalMs?: number; idleTimeoutMs?: number; now?: () => number };

async function session(options: Options = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "pi-github-"));
  const { pi, ctx, emit } = harness(dir);
  const contributor = createContributor(pi, "pi-github");
  const fake = fakeGitHub();
  const failures: BuildFailure[] = [];
  const trackers: Array<ReturnType<typeof createTracker>> = [];
  const newTracker = () => {
    const created = createTracker({
      github: fake.github, ...options, onBuildFailure: (failure) => { failures.push(failure); },
      session: {
        read: async () => (await contributor.getSession(ctx)).extensions["pi-github"]?.data,
        update: async (change) => (await contributor.updateSession(ctx, change)).extensions["pi-github"]?.data,
      },
    });
    trackers.push(created);
    return created;
  };
  const tracker = newTracker();
  const data = async () => ((await contributor.getSession(ctx)).extensions["pi-github"]?.data ?? {}) as { builds?: Build[]; pullRequests?: PullRequest[] };
  const builds = async () => (await data()).builds ?? [];
  const pullRequests = async () => (await data()).pullRequests ?? [];
  const close = async () => {
    for (const item of trackers) item.stop();
    await emit("session_shutdown");
    await rm(dir, { recursive: true, force: true });
  };
  return { dir, tracker, newTracker, fake, failures, builds, pullRequests, start: () => emit("session_start"), close };
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

test("a push records its build and the branch's pull request", async () => {
  const s = await session();
  try {
    await s.start();
    s.fake.pulls.set("feature", pr(7, "feature"));
    s.fake.checks.set("abc", [run("success")]);
    await s.tracker.recordPush(push("feature", "abc"));
    const [build] = await s.builds();
    assert.equal(build!.branch, "feature");
    assert.equal(build!.sha, "abc");
    assert.equal(build!.pushedAt, "2026-01-01T00:00:00.000Z");
    assert.equal(build!.checks?.state, "success");
    assert.deepEqual((await s.pullRequests()).map((item) => item.number), [7]);
  } finally { await s.close(); }
});

test("a push to main records a build without a pull request", async () => {
  const s = await session();
  try {
    await s.start();
    s.fake.checks.set("m1", [run("success")]);
    await s.tracker.recordPush(push("main", "m1", "https://github.com/o/r.git"));
    assert.equal((await s.builds())[0]!.checks?.state, "success");
    assert.deepEqual(await s.pullRequests(), []);
  } finally { await s.close(); }
});

test("pushes to remotes outside GitHub are not tracked", async () => {
  const s = await session();
  try {
    await s.start();
    await s.tracker.recordPush(push("main", "m1", "https://gitlab.com/o/r.git"));
    assert.deepEqual(await s.builds(), []);
  } finally { await s.close(); }
});

test("pending builds are polled until they finish", async () => {
  const s = await session({ pollIntervalMs: 10 });
  try {
    await s.start();
    s.fake.checks.set("abc", [run("pending"), run("pending"), run("success")]);
    await s.tracker.recordPush(push("feature", "abc"));
    assert.equal((await s.builds())[0]!.checks?.state, "pending");
    await until(async () => (await s.builds())[0]!.checks?.state === "success");
  } finally { await s.close(); }
});

test("a fresh push is polled until GitHub registers its builds", async () => {
  const s = await session({ pollIntervalMs: 10 });
  try {
    await s.start();
    s.fake.checks.set("abc", [[], [], run("success")]);
    await s.tracker.recordPush(push("feature", "abc", undefined, Date.now()));
    assert.equal((await s.builds())[0]!.checks?.state, "none");
    await until(async () => (await s.builds())[0]!.checks?.state === "success");
  } finally { await s.close(); }
});

test("a pull request opened after a fresh push is found by polling", async () => {
  const s = await session({ pollIntervalMs: 10 });
  try {
    await s.start();
    s.fake.checks.set("abc", [run("success")]);
    await s.tracker.recordPush(push("feature", "abc", undefined, Date.now()));
    assert.deepEqual(await s.pullRequests(), []);
    s.fake.pulls.set("feature", pr(8, "feature"));
    await until(async () => (await s.pullRequests()).some((item) => item.number === 8));
  } finally { await s.close(); }
});

test("a new push replaces the build of the previous commit", async () => {
  const s = await session();
  try {
    await s.start();
    s.fake.checks.set("abc", [run("success")]);
    await s.tracker.recordPush(push("feature", "abc"));
    s.fake.setFailing(true);
    await s.tracker.recordPush(push("feature", "def"));
    const builds = await s.builds();
    assert.equal(builds.length, 1);
    assert.equal(builds[0]!.sha, "def");
    assert.equal(builds[0]!.checks, null);
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
    assert.equal((await s.builds())[0]!.checks?.state, "pending");
    s.tracker.touch();
    await until(async () => (await s.builds())[0]!.checks?.state === "success");
  } finally { await s.close(); }
});

test("GitHub errors keep the last known data until a refresh succeeds", async () => {
  const s = await session();
  try {
    await s.start();
    s.fake.pulls.set("feature", pr(7, "feature"));
    await s.tracker.recordPush(push("feature", "abc"));
    s.fake.setFailing(true);
    await s.tracker.refresh();
    assert.equal((await s.pullRequests())[0]!.state, "open");
    s.fake.setFailing(false);
    s.fake.pulls.set("feature", pr(7, "feature", "merged"));
    await s.tracker.refresh();
    assert.equal((await s.pullRequests())[0]!.state, "merged");
  } finally { await s.close(); }
});

test("saved pull request URLs from older sessions gain their branch on refresh", async () => {
  const s = await session();
  try {
    await writeFile(path.join(s.dir, "s.jsonl.context.json"), JSON.stringify({
      version: 2, sessionId: "s", extensions: { "pi-github": { version: 1, data: { pullRequests: ["https://github.com/o/r/pull/3"] } } },
    }));
    await s.start();
    s.fake.pulls.set("old", pr(3, "old"));
    await s.tracker.refresh();
    const [saved] = await s.pullRequests();
    assert.equal(saved!.branch, "old");
    assert.equal(saved!.title, "PR 3");
  } finally { await s.close(); }
});

test("a pull request saved by URL shares its branch's build and is removed with it", async () => {
  const s = await session();
  try {
    await s.start();
    s.fake.pulls.set("given", pr(9, "given"));
    const saved = await s.tracker.trackPullRequest("https://github.com/o/r/pull/9");
    assert.equal(saved.branch, "given");
    await s.tracker.recordPush(push("given", "jkl"));
    assert.equal((await s.pullRequests()).length, 1);
    assert.equal((await s.builds()).length, 1);
    await s.tracker.untrackPullRequest("https://github.com/o/r/pull/9");
    await s.tracker.refresh();
    assert.deepEqual(await s.pullRequests(), []);
    assert.deepEqual(await s.builds(), []);
    await assert.rejects(s.tracker.untrackPullRequest("https://github.com/o/r/pull/9"), /PR not found/);
  } finally { await s.close(); }
});

test("a stopped tracker writes nothing", async () => {
  const s = await session();
  try {
    await s.start();
    s.tracker.stop();
    await s.tracker.recordPush(push("feature", "abc"));
    assert.deepEqual(await s.builds(), []);
  } finally { await s.close(); }
});

test("a pushed build that already failed is reported once", async () => {
  const s = await session();
  try {
    await s.start();
    s.fake.checks.set("abc", [run("failure")]);
    await s.tracker.recordPush(push("feature", "abc"));
    await s.tracker.refresh();
    assert.deepEqual(s.failures.map((failure) => failure.build.sha), ["abc"]);
  } finally { await s.close(); }
});

test("a pending build that fails while polling is reported with its pull request", async () => {
  const s = await session({ pollIntervalMs: 10 });
  try {
    await s.start();
    s.fake.pulls.set("feature", pr(7, "feature"));
    s.fake.checks.set("abc", [run("pending"), run("failure")]);
    await s.tracker.recordPush(push("feature", "abc"));
    assert.equal(s.failures.length, 0);
    await until(async () => (await s.builds())[0]!.checks?.state === "failure");
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(s.failures.length, 1);
    assert.equal(s.failures[0]!.pullRequest?.number, 7);
  } finally { await s.close(); }
});

test("a resumed session does not report a saved failure again", async () => {
  const s = await session();
  try {
    await s.start();
    s.fake.checks.set("abc", [run("failure")]);
    await s.tracker.recordPush(push("feature", "abc"));
    s.tracker.stop();
    await s.newTracker().refresh();
    assert.equal(s.failures.length, 1);
  } finally { await s.close(); }
});

test("a failed build of a pushed commit is shown and sent to the agent", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pi-github-"));
  const { pi, emit, emitter, messages } = harness(dir);
  const fake = fakeGitHub();
  try {
    register(pi, { github: fake.github });
    await emit("session_start");
    fake.checks.set("abc", [[{ name: "test", state: "failure", url: "https://github.com/o/r/actions/runs/1" }]]);
    emitter.emit(PUSH_EVENT, push("main", "abc"));
    await until(async () => messages.length > 0);
    assert.equal(messages.length, 1);
    assert.equal(messages[0]!.customType, "pi-github-build-failure");
    assert.equal(messages[0]!.display, true);
    assert.match(String(messages[0]!.content), /https:\/\/github\.com\/o\/r\/actions\/runs\/1/);
  } finally {
    await emit("session_shutdown");
    await rm(dir, { recursive: true, force: true });
  }
});
