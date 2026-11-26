import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import aggregate from "../packages/pi-workbench/src/index.ts";

test("aggregate registers every tool once", () => {
  const tools = new Map<string, unknown>();
  const pi = {
    on: () => {},
    registerTool: (tool: { name: string }) => { if (tools.has(tool.name)) throw new Error(`duplicate tool ${tool.name}`); tools.set(tool.name, tool); },
    registerCommand: () => {},
    getSessionName: () => "Test session",
    setSessionName: () => {},
  } as unknown as ExtensionAPI;
  aggregate(pi);
  assert.deepEqual([...tools.keys()], ["set_session_name"]);
});
