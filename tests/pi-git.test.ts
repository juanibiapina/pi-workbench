import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createPushDetector, PUSH_EVENT, register, type PushEvent } from "../packages/pi-git/src/index.ts";

const env = { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env, stdio: "pipe" }).toString().trim();
const commit = (cwd: string, message: string) => { git(cwd, "commit", "-q", "--allow-empty", "-m", message); return git(cwd, "rev-parse", "HEAD"); };

async function repository(initArgs: string[] = []) {
  const root = await mkdtemp(path.join(tmpdir(), "pi-git-"));
  const remote = path.join(root, "remote.git");
  const work = path.join(root, "work");
  git(root, "init", "-q", "--bare", "-b", "main", ...initArgs, remote);
  git(root, "init", "-q", "-b", "main", ...initArgs, work);
  git(work, "remote", "add", "origin", remote);
  const first = commit(work, "one");
  git(work, "push", "-q", "origin", "main");
  return { root, remote, work, first, close: () => rm(root, { recursive: true, force: true }) };
}

test("a push to a named remote is reported once with its branch and commits", async () => {
  const repo = await repository();
  try {
    const detector = await createPushDetector({ cwd: repo.work });
    assert.deepEqual(await detector.check(), []);
    const second = commit(repo.work, "two");
    git(repo.work, "push", "-q", "origin", "main");
    git(repo.work, "push", "-q", "origin", "main:feature/x");
    const pushes = await detector.check();
    assert.deepEqual(pushes.map(({ pushedAt: _pushedAt, ...push }) => push).sort((a, b) => a.branch.localeCompare(b.branch)), [
      { repository: await realpath(repo.work), remote: "origin", remoteUrl: repo.remote, branch: "feature/x", before: null, after: second },
      { repository: await realpath(repo.work), remote: "origin", remoteUrl: repo.remote, branch: "main", before: repo.first, after: second },
    ]);
    assert.deepEqual(await detector.check(), []);
  } finally { await repo.close(); }
});

test("fetches and pushes from before the session started are not reported", async () => {
  const repo = await repository();
  try {
    commit(repo.work, "before");
    git(repo.work, "push", "-q", "origin", "main");
    const detector = await createPushDetector({ cwd: repo.work });
    const other = path.join(repo.root, "other");
    git(repo.root, "clone", "-q", repo.remote, other);
    commit(other, "elsewhere");
    git(other, "push", "-q", "origin", "main");
    git(repo.work, "fetch", "-q");
    assert.deepEqual(await detector.check(), []);
  } finally { await repo.close(); }
});

test("force pushes and pushes from linked worktrees are reported", async () => {
  const repo = await repository();
  try {
    const detector = await createPushDetector({ cwd: repo.work });
    commit(repo.work, "two");
    git(repo.work, "push", "-q", "origin", "main");
    git(repo.work, "reset", "-q", "--hard", repo.first);
    const rewritten = commit(repo.work, "rewritten");
    git(repo.work, "push", "-q", "--force", "origin", "main");
    const tree = path.join(repo.root, "tree");
    git(repo.work, "worktree", "add", "-q", "-b", "side", tree);
    const side = commit(tree, "side");
    git(tree, "push", "-q", "origin", "side");
    const pushes = await detector.check();
    assert.deepEqual(pushes.filter((push) => push.branch === "main").map((push) => push.after).at(-1), rewritten);
    assert.equal(pushes.filter((push) => push.branch === "main").length, 2);
    assert.equal(pushes.find((push) => push.branch === "side")?.after, side);
  } finally { await repo.close(); }
});

test("repositories with reftable storage report pushes", async (t) => {
  let repo;
  try { repo = await repository(["--ref-format=reftable"]); }
  catch { t.skip("git does not support reftable"); return; }
  try {
    const detector = await createPushDetector({ cwd: repo.work });
    const second = commit(repo.work, "two");
    git(repo.work, "push", "-q", "origin", "main");
    assert.deepEqual((await detector.check()).map((push) => push.after), [second]);
  } finally { await repo.close(); }
});

test("concurrent checks report each push once", async () => {
  const repo = await repository();
  try {
    const detector = await createPushDetector({ cwd: repo.work });
    commit(repo.work, "two");
    git(repo.work, "push", "-q", "origin", "main");
    const results = await Promise.all([detector.check(), detector.check(), detector.check()]);
    assert.equal(results.flat().length, 1);
  } finally { await repo.close(); }
});

test("a directory outside git reports nothing", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pi-git-none-"));
  try {
    const detector = await createPushDetector({ cwd: dir });
    assert.deepEqual(await detector.check(), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("the extension marks agent pushes and keeps only this worktree's outside pushes", async () => {
  const repo = await repository();
  try {
    const emitter = new EventEmitter();
    const handlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => unknown>>();
    register({
      events: { emit: (name: string, value: unknown) => emitter.emit(name, value), on: (name: string, handler: (value: unknown) => void) => { emitter.on(name, handler); return () => emitter.off(name, handler); } },
      on: (name: string, handler: any) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
    } as unknown as ExtensionAPI);
    const emit = async (name: string) => { for (const handler of handlers.get(name) ?? []) await handler({ type: name }, { cwd: repo.work } as ExtensionContext); };
    const events: PushEvent[] = [];
    emitter.on(PUSH_EVENT, (push: PushEvent) => events.push(push));
    await emit("session_start");

    commit(repo.work, "agent");
    git(repo.work, "push", "-q", "origin", "main");
    await emit("tool_execution_end");
    await emit("before_agent_start");
    assert.deepEqual(events.map((push) => [push.branch, push.source]), [["main", "agent"]]);

    const tree = path.join(repo.root, "tree");
    git(repo.work, "worktree", "add", "-q", "-b", "side", tree);
    commit(tree, "side");
    git(tree, "push", "-q", "origin", "side");
    commit(repo.work, "terminal");
    git(repo.work, "push", "-q", "origin", "main");
    await emit("before_agent_start");
    assert.deepEqual(events.map((push) => [push.branch, push.source]), [["main", "agent"], ["main", "external"]]);
  } finally { await repo.close(); }
});

async function realpath(file: string) {
  return (await import("node:fs/promises")).realpath(file);
}
