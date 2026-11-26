import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { register as skills } from "../packages/pi-skills/src/index.ts";
import aggregate from "../packages/pi-workbench/src/index.ts";

function harness(root: string) {
  const tools = new Map<string, any>();
  const pi = {
    on: () => {},
    registerTool: (tool: any) => { if (tools.has(tool.name)) throw new Error(`duplicate tool ${tool.name}`); tools.set(tool.name, tool); },
    registerCommand: () => {},
    getSessionName: () => "Test session",
    setSessionName: () => {},
    exec: async () => ({ code: 1, stdout: "", stderr: "", killed: false }),
  } as unknown as ExtensionAPI;
  const ctx = () => ({ cwd: root, hasUI: false, isIdle: () => true, getSystemPrompt: () => "" }) as ExtensionContext;
  const call = (name: string, context: ExtensionContext, params: unknown) =>
    tools.get(name).execute("test", params, undefined, undefined, context);
  return { pi, ctx, call, tools };
}

test("aggregate registers every tool once", () => {
  const { pi, tools } = harness(tmpdir());
  aggregate(pi);
  assert.deepEqual([...tools.keys()].sort(), ["load_skill", "set_session_name"]);
});

test("loading a local skill returns full instructions and its resolved identity", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pi-skill-render-"));
  try {
    const { pi, ctx, call } = harness(dir);
    const filePath = path.join(dir, "skills", "example-skill", "SKILL.md");
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "---\nname: example-skill\ndescription: Example\n---\n\n# Instructions\nUse the example.\n");
    const context = ctx();
    context.getSystemPrompt = () => `<available_skills><skill><name>example-skill</name><description>Example</description><location>${filePath}</location></skill></available_skills>`;
    skills(pi);
    const loaded = await call("load_skill", context, { source: "example-skill" });
    assert.deepEqual(loaded.details, { source: "example-skill", name: "example-skill", filePath });
    assert.ok(loaded.content[0].text.includes("# Instructions\nUse the example."));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
