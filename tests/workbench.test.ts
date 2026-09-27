import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createContributor } from "../packages/pi-session-context/src/client.ts";
import { register as provider } from "../packages/pi-session-context/src/index.ts";
import { register as plans } from "../packages/pi-plans/src/index.ts";
import { register as github } from "../packages/pi-github/src/index.ts";
import { register as skills } from "../packages/pi-skills/src/index.ts";
import aggregate from "../packages/pi-workbench/src/index.ts";
import { register as socket } from "../packages/pi-socket/src/index.ts";
import { sendSocketRequest } from "../packages/pi-socket/src/socket-server.ts";
import { register as tmux } from "../packages/pi-tmux/src/index.ts";

function harness(root: string) {
  const emitter = new EventEmitter();
  const handlers = new Map<string, Array<(event: any, ctx: ExtensionContext) => any>>();
  const tools = new Map<string, any>();
  const pi = {
    events: { emit: (channel: string, value: unknown) => emitter.emit(channel, value),
      on: (channel: string, handler: (value: unknown) => void) => { emitter.on(channel, handler); return () => emitter.off(channel, handler); } },
    on: (event: string, handler: any) => { handlers.set(event, [...(handlers.get(event) ?? []), handler]); },
    registerTool: (tool: any) => { if (tools.has(tool.name)) throw new Error(`duplicate tool ${tool.name}`); tools.set(tool.name, tool); },
    getSessionName: () => "Test session",
    exec: async () => ({ code: 1, stdout: "", stderr: "", killed: false }),
  } as unknown as ExtensionAPI;
  const ctx = (id: string) => ({
    cwd: root, hasUI: false, isIdle: () => true, getSystemPrompt: () => "",
    sessionManager: { getSessionId: () => id, getSessionFile: () => path.join(root, `${id}.jsonl`) },
  }) as ExtensionContext;
  const emit = async (name: string, context: ExtensionContext) => {
    for (const handler of handlers.get(name) ?? []) await handler({ type: name }, context);
  };
  const call = (name: string, context: ExtensionContext, params: unknown) =>
    tools.get(name).execute("test", params, undefined, undefined, context);
  return { pi, ctx, emit, call, tools };
}

test("isolated clients preserve concurrent namespaces and reject duplicate owners", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pi-provider-"));
  try {
    const { pi, ctx, emit } = harness(dir);
    const first = createContributor(pi, "example.bookmarks");
    provider(pi, { dataDir: dir });
    const second = createContributor(pi, "example.other");
    const context = ctx("one");
    await emit("session_start", context);
    await Promise.all([first.putSession(context, { items: ["one"] }), second.putSession(context, { count: 2 })]);
    const saved = await first.getSession(context);
    assert.deepEqual(saved.extensions["example.bookmarks"].data, { items: ["one"] });
    assert.deepEqual(saved.extensions["example.other"].data, { count: 2 });
    await assert.rejects(createContributor(pi, "example.bookmarks").putSession(context, {}), /Duplicate namespace/);
    await first.putRuntime(context, { pane: "%0" });
    assert.deepEqual((await second.getRuntime(context)).extensions["example.bookmarks"].data, { pane: "%0" });
    assert.equal((await stat(path.join(dir, "status", "one.json"))).mode & 0o777, 0o600);
    await emit("session_shutdown", context);
    await assert.rejects(stat(path.join(dir, "status", "one.json")), { code: "ENOENT" });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("legacy session plans remain editable after migration and deletion", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pi-plans-"));
  try {
    const { pi, ctx, emit, call } = harness(dir);
    const context = ctx("legacy");
    const contextPath = `${path.join(dir, "legacy.jsonl")}.context.json`;
    await writeFile(contextPath, JSON.stringify({ version: 1, sessionId: "legacy", plans: [], pullRequests: ["https://github.com/o/r/pull/3"], skills: ["old-skill"] }));
    plans(pi); github(pi); skills(pi); provider(pi, { dataDir: dir });
    await emit("session_start", context);
    const saved = await call("save_plan", context, { title: "Build", content: "# First\n" });
    const plan = saved.details.plan;
    await writeFile(plan.path, "# Revised\n");
    const listed = await call("get_session_context", context, {});
    const view = listed.details;
    assert.ok(listed.content[0].text.includes(plan.path));
    assert.deepEqual(view.attachments, [{ id: plan.id, path: plan.path }]);
    assert.deepEqual(view.extensions["pi-plans"].data.plans, [{ id: plan.id, title: "Build", path: `legacy.jsonl.plans/${plan.id}.md` }]);
    assert.deepEqual(view.extensions["pi-github"].data.pullRequests, ["https://github.com/o/r/pull/3"]);
    assert.deepEqual(view.extensions["pi-skills"].data.skills, ["old-skill"]);
    assert.equal(await readFile(plan.path, "utf8"), "# Revised\n");
    assert.equal(JSON.parse(await readFile(contextPath, "utf8")).version, 2);
    assert.equal(JSON.parse(await readFile(`${contextPath}.v1.bak`, "utf8")).version, 1);
    await call("delete_plan", context, { planId: plan.id });
    await assert.rejects(stat(plan.path), { code: "ENOENT" });
    await emit("session_shutdown", context);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("invalid legacy data remains intact instead of being migrated", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pi-invalid-legacy-"));
  try {
    const { pi, ctx, emit } = harness(dir);
    const file = path.join(dir, "invalid.jsonl.context.json");
    const old = JSON.stringify({ version: 1, sessionId: "invalid", plans: [{ id: "0123456789abcdef01234567", title: "Bad", path: "../../other.plans/0123456789abcdef01234567.md" }] });
    await writeFile(file, old);
    provider(pi, { dataDir: dir });
    await assert.rejects(emit("session_start", ctx("invalid")), /Invalid legacy plan/);
    assert.equal(await readFile(file, "utf8"), old);
    await assert.rejects(stat(`${file}.v1.bak`), { code: "ENOENT" });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a feature alone reports a missing provider instead of writing", async () => {
  const { pi, ctx, call } = harness(tmpdir());
  github(pi);
  await assert.rejects(call("save_pr", ctx("without-provider"), { url: "https://github.com/o/r/pull/1" }), /provider is unavailable/);
});

test("aggregate registers every tool once without tmux", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pi-aggregate-"));
  const oldTmux = process.env.TMUX;
  delete process.env.TMUX;
  try {
    const { pi, ctx, emit, tools, call } = harness(dir);
    aggregate(pi);
    for (const name of ["get_session_context", "save_plan", "delete_plan", "save_pr", "remove_pr", "load_skill"]) assert.ok(tools.has(name));
    const context = ctx("aggregate");
    await emit("session_start", context);
    await call("save_pr", context, { url: "https://github.com/o/r/pull/2" });
    const view = await call("get_session_context", context, {});
    assert.deepEqual(view.details.extensions["pi-github"].data.pullRequests, ["https://github.com/o/r/pull/2"]);
    await emit("session_shutdown", context);
  } finally {
    if (oldTmux !== undefined) process.env.TMUX = oldTmux;
    await rm(dir, { recursive: true, force: true });
  }
});


test("socket feature answers requests and publishes only its endpoint", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pi-socket-"));
  try {
    const { pi, ctx, emit } = harness(dir);
    provider(pi, { dataDir: dir }); socket(pi, { dataDir: dir });
    const context = ctx("socket");
    await emit("session_start", context);
    const runtime = await createContributor(pi, "reader").getRuntime(context);
    const endpoint = (runtime.extensions["pi-socket"].data as {socketPath: string}).socketPath;
    assert.equal((await sendSocketRequest(endpoint, { type: "ping" })).ok, true);
    await emit("session_shutdown", context);
    await assert.rejects(sendSocketRequest(endpoint, { type: "ping" }));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("tmux feature publishes the exact server and keeps pane markers", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pi-tmux-"));
  const previous = { tmux: process.env.TMUX, pane: process.env.TMUX_PANE };
  process.env.TMUX = "/tmp/current-tmux.sock,1,0";
  process.env.TMUX_PANE = "%0";
  try {
    const { pi, ctx, emit } = harness(dir);
    const calls: string[][] = [];
    pi.exec = async (_binary: string, args: string[]) => {
      calls.push(args);
      return { code: 0, stderr: "", killed: false, stdout: args[0] === "display-message" && args.at(-1)?.includes("#{pane_id}")
        ? "%0\u001fmain\u001f0\u001feditor\u001f/tmp/current-tmux.sock\n"
        : args[0] === "list-panes" ? "working\n" : "1\n" };
    };
    provider(pi, { dataDir: dir }); tmux(pi);
    const context = ctx("tmux");
    await emit("session_start", context);
    const runtime = await createContributor(pi, "reader").getRuntime(context);
    assert.deepEqual(runtime.extensions["pi-tmux"].data, {
      paneId: "%0", sessionName: "main", windowIndex: 0, windowName: "editor", socketPath: "/tmp/current-tmux.sock",
    });
    await emit("agent_start", context);
    assert.ok(calls.some((args) => args.includes("@pi_state") && args.includes("working")));
    await emit("session_shutdown", context);
  } finally {
    if (previous.tmux === undefined) delete process.env.TMUX; else process.env.TMUX = previous.tmux;
    if (previous.pane === undefined) delete process.env.TMUX_PANE; else process.env.TMUX_PANE = previous.pane;
    await rm(dir, { recursive: true, force: true });
  }
});
