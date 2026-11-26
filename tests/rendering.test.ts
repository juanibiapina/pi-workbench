import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { ToolExecutionComponent, initTheme, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getOsc8LinkAtColumn, setCapabilityOverrides, visibleWidth } from "@earendil-works/pi-tui";
import aggregate from "../packages/pi-workbench/src/index.ts";

initTheme("dark");
const emitter = new EventEmitter();
const tools = new Map<string, any>();
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

const skillPath = "/tmp/skills/vocabulary/SKILL.md";
const skillContent = `<skill name="vocabulary" location="${skillPath}">\nReferences are relative to /tmp/skills/vocabulary.\n\n# Language\n${Array.from({ length: 30 }, (_, i) => `Instruction ${i + 1}`).join("\n")}\n</skill>`;
const samples = [
  { name: "load_skill", args: { source: "vocabulary" }, details: { source: "vocabulary", name: "vocabulary", filePath: skillPath }, content: skillContent, call: "vocabulary", summary: "Loaded vocabulary", expanded: skillPath },
];

test("tools use one collapsed line and bounded expanded details", () => {
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

test("expanded file paths are clickable when this terminal supports links", () => {
  setCapabilityOverrides({ hyperlinks: true });
  try {
    const links = (lines: string[]) => lines.flatMap((line) =>
      Array.from({ length: 72 }, (_, column) => getOsc8LinkAtColumn(line, column)).filter((url) => url !== undefined));
    const skillView = display("load_skill", { source: "vocabulary" }, {
      content: [{ type: "text", text: skillContent }], details: samples[0].details, isError: false,
    });
    assert.ok(links(skillView.raw.expanded).includes("file:///tmp/skills/vocabulary/SKILL.md"));
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
