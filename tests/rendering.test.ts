import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { CustomMessageComponent, ToolExecutionComponent, initTheme, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getOsc8LinkAtColumn, setCapabilityOverrides, visibleWidth } from "@earendil-works/pi-tui";
import aggregate from "../packages/pi-workbench/src/index.ts";

initTheme("dark");
const emitter = new EventEmitter();
const tools = new Map<string, any>();
const renderers = new Map<string, any>();
aggregate({
  events: {
    emit: (event: string, value: unknown) => emitter.emit(event, value),
    on: (event: string, handler: (value: unknown) => void) => {
      emitter.on(event, handler);
      return () => emitter.off(event, handler);
    },
  },
  on: () => {},
  registerTool: (tool: any) => { tools.set(tool.name, tool); },
  registerCommand: () => {},
  registerMessageRenderer: (type: string, renderer: any) => { renderers.set(type, renderer); },
  getSessionName: () => "Preview",
  setSessionName: () => {},
} as unknown as ExtensionAPI);

function display(name: string, args: object, result: { content: Array<{ type: "text"; text: string }>; details?: unknown; isError: boolean }, width = 72) {
  const component = new ToolExecutionComponent(name, `call-${name}`, args, {}, tools.get(name), { requestRender() {} } as any, process.cwd());
  const call = component.render(width);
  component.updateResult(result);
  const collapsed = component.render(width);
  component.setExpanded(true);
  const expanded = component.render(width);
  for (const line of [...call, ...collapsed, ...expanded]) assert.ok(visibleWidth(line) <= width);
  const plain = (lines: string[]) => lines.join("\n").replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, "").replace(/\x1b\[[0-9;]*m/g, "");
  return { call: plain(call), collapsed: plain(collapsed), expanded: plain(expanded), raw: { call, collapsed, expanded }, component };
}

const plan = { id: "0123456789abcdef01234567", title: "Improve rendering", path: "/tmp/session.plans/0123456789abcdef01234567.md" };
const pr = "https://github.com/juanibiapina/pi-workbench/pull/42";
const skillPath = "/tmp/skills/vocabulary/SKILL.md";
const skillContent = `<skill name="vocabulary" location="${skillPath}">\nReferences are relative to /tmp/skills/vocabulary.\n\n# Language\n${Array.from({ length: 30 }, (_, i) => `Instruction ${i + 1}`).join("\n")}\n</skill>`;
const samples = [
  { name: "load_skill", args: { source: "vocabulary" }, details: { source: "vocabulary", name: "vocabulary", filePath: skillPath }, content: skillContent, call: "vocabulary", summary: "Loaded vocabulary", expanded: skillPath },
  { name: "get_session_context", args: {}, details: { contextPath: "/tmp/session.context.json", extensions: { "pi-skills": {}, "pi-plans": {} }, attachments: [{ id: plan.id, path: plan.path }] }, content: "Session details and large JSON", call: "get_session_context", summary: "2 namespaces · 1 attachment", expanded: plan.path },
  { name: "save_plan", args: { title: plan.title, content: "# A very long plan\n" }, details: { plan }, content: "Saved plan", call: plan.title, summary: "Saved Improve rendering", expanded: plan.id },
  { name: "delete_plan", args: { planId: plan.id }, details: { plan }, content: "Deleted plan", call: plan.id, summary: "Deleted Improve rendering", expanded: plan.path },
  { name: "save_pr", args: { url: pr }, details: { pullRequest: pr }, content: "Saved PR", call: "pi-workbench#42", summary: "Saved PR", expanded: pr },
  { name: "remove_pr", args: { url: pr }, details: { pullRequest: pr }, content: "Removed PR", call: "pi-workbench#42", summary: "Removed PR", expanded: pr },
];

test("all six tools use one collapsed line and bounded expanded details", () => {
  for (const sample of samples) {
    const result = { content: [{ type: "text" as const, text: sample.content }], details: sample.details, isError: false };
    const wide = display(sample.name, sample.args, result);
    assert.ok(wide.call.includes(sample.call), `${sample.name} call`);
    assert.equal(wide.collapsed.split("\n").filter((line) => line.trim()).length, 1, `${sample.name} collapsed lines`);
    assert.ok(wide.expanded.includes(sample.expanded), `${sample.name} expanded`);
    assert.ok(!wide.expanded.includes("✓"), `${sample.name} repeated success heading`);
    display(sample.name, sample.args, result, 32);
  }
});

test("PR call labels and expanded file paths are clickable when this terminal supports links", () => {
  setCapabilityOverrides({ hyperlinks: true });
  try {
    const links = (lines: string[]) => lines.flatMap((line) =>
      Array.from({ length: 72 }, (_, column) => getOsc8LinkAtColumn(line, column)).filter((url) => url !== undefined));
    const prView = display("save_pr", { url: pr }, { content: [{ type: "text", text: "Saved PR" }], details: { pullRequest: pr }, isError: false });
    assert.ok(links(prView.raw.collapsed).includes(pr));
    const file = "/tmp/project notes/plan.md";
    const planView = display("save_plan", { title: "Notes", content: "# Notes" }, {
      content: [{ type: "text", text: "Saved plan" }], details: { sessionId: "session-a", plan: { ...plan, path: file } }, isError: false,
    });
    assert.ok(links(planView.raw.expanded).includes("file:///tmp/project%20notes/plan.md"));
    assert.ok(links(planView.raw.expanded).includes(`http://127.0.0.1:19433/plans/session-a/${plan.id}`));
    const skillView = display("load_skill", { source: "vocabulary" }, {
      content: [{ type: "text", text: skillContent }], details: samples[0].details, isError: false,
    });
    assert.ok(links(skillView.raw.expanded).includes("file:///tmp/skills/vocabulary/SKILL.md"));
    const contextView = display("get_session_context", {}, {
      content: [{ type: "text", text: "Session details" }], details: samples[1].details, isError: false,
    });
    assert.ok(links(contextView.raw.expanded).includes(`file://${plan.path}`));
  } finally {
    setCapabilityOverrides({});
  }
});

test("large skill results stay short until expanded, and old results remain readable", () => {
  const result = { content: [{ type: "text" as const, text: skillContent }], details: samples[0].details, isError: false };
  const view = display("load_skill", { source: "vocabulary" }, result);
  assert.ok(!view.collapsed.includes("Instruction 1"));
  assert.ok(view.expanded.includes("Instruction 1"));
  assert.ok(!view.expanded.includes("Instruction 30"));
  const old = display("load_skill", { source: "vocabulary" }, { content: result.content, isError: false });
  assert.equal(old.collapsed.split("\n").filter((line) => line.trim()).length, 1);
});

test("tool failures and partial results never claim success", () => {
  for (const sample of samples) {
    const failure = display(sample.name, sample.args, { content: [{ type: "text", text: "Operation failed: example" }], isError: true });
    assert.ok(failure.collapsed.includes("Operation failed: example"), sample.name);
    assert.ok(!failure.collapsed.includes("✓"), sample.name);
  }
  const partial = display("load_skill", { source: "vocabulary" }, { content: [], isError: false });
  partial.component.setExpanded(false);
  partial.component.updateResult({ content: [], isError: false }, true);
  const lines = partial.component.render(72).join("\n");
  assert.ok(lines.includes("load_skill"));
  assert.ok(!lines.includes("Loading skill"));
  assert.ok(!lines.includes("✓"));
});

test("a saved plan shows Jev's review status, with finding quotes expanded", () => {
  const review = { model: "jev-1.13.0", scores: {}, findings: [
    { kind: "existing_tool", line: "Compute the sun with hand-written NOAA equations.", probability: 0.82 },
    { kind: "simpler_design", line: "Add a log collector process.", probability: 0.73 },
  ] };
  const view = display("save_plan", { title: plan.title, content: "# Plan" }, {
    content: [{ type: "text", text: "Saved plan" }], details: { sessionId: "session-a", plan, review }, isError: false,
  });
  const collapsed = view.collapsed.split("\n").filter((line) => line.trim());
  assert.equal(collapsed.length, 2);
  assert.ok(collapsed[1].includes("Jev: 2 findings"));
  const expanded = view.expanded.replace(/\s+/g, " ");
  assert.ok(expanded.includes("Compute the sun with hand-written NOAA equations."));
  assert.ok(expanded.includes("May be simpler without this part (0.73)"));
  const clean = display("save_plan", { title: plan.title, content: "# Plan" }, {
    content: [{ type: "text", text: "Saved plan" }], details: { sessionId: "session-a", plan, review: { ...review, findings: [] } }, isError: false,
  });
  assert.ok(clean.collapsed.includes("Jev: no findings"));
  const failed = display("save_plan", { title: plan.title, content: "# Plan" }, {
    content: [{ type: "text", text: "Saved plan" }], details: { sessionId: "session-a", plan, review: { error: "timed out" } }, isError: false,
  });
  assert.ok(failed.collapsed.includes("Jev: review failed (timed out)"));
  assert.ok(failed.expanded.includes("Jev: review failed (timed out)"));
});

test("a build failure shows one line collapsed and its failed checks expanded", () => {
  const build = {
    repository: "o/r", branch: "feature", sha: "abc1234567", pushedAt: "2026-01-01T00:00:00.000Z", source: "agent",
    checks: { sha: "abc1234567", state: "failure", updatedAt: "2026-01-01T00:00:00.000Z", runs: [
      { name: "test", state: "failure", url: "https://github.com/o/r/actions/runs/1" },
      { name: "lint", state: "success", url: "https://github.com/o/r/actions/runs/2" },
    ] },
  };
  const pullRequest = { repository: "o/r", number: 7, url: "https://github.com/o/r/pull/7", branch: "feature", title: "PR 7", state: "open" };
  const message = { role: "custom", customType: "pi-github-build-failure", content: "text for the model", display: true, details: { build, pullRequest }, timestamp: 0 };
  const component = new CustomMessageComponent(message as any, renderers.get("pi-github-build-failure"));
  const plain = (lines: string[]) => lines.join("\n").replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, "").replace(/\x1b\[[0-9;]*m/g, "");
  const collapsed = plain(component.render(72));
  assert.match(collapsed, /Build failed o\/r feature abc1234 o\/r#7/);
  assert.doesNotMatch(collapsed, /test|text for the model/);
  component.setExpanded(true);
  const expanded = plain(component.render(72));
  assert.match(expanded, /test/);
  assert.doesNotMatch(expanded, /lint/);
});
