import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { register as provider } from "../packages/pi-session-context/src/index.ts";
import { register as plans } from "../packages/pi-plans/src/index.ts";
import { reviewPlan } from "../packages/pi-plans/src/plan-review.ts";

type Answer = (question: string, line: string) => number | string;
type Call = { questions: Record<string, any>; signal?: AbortSignal };

const HAND_BUILT = "Compute the sun position with the NOAA Solar Calculator equations, written by hand.";
const TOGGLE = "Add a settings toggle for the sun.";
const PLAN = `# Sun\n\n## Steps\n\n1. ${HAND_BUILT}\n2. ${TOGGLE}\n`;

function lineOf(instructions: string): string {
  return JSON.parse(/^Line: (".*")$/m.exec(instructions)![1]);
}

function fakeRegistry(answer: Answer, options: { classify?: (call: Call) => Promise<any>; model?: boolean } = {}) {
  const calls: Call[] = [];
  const model = { type: "classifier", provider: "typesafe", id: "jev-latest" };
  return {
    calls,
    registry: {
      findOfType: (type: string, providerName: string, id: string) =>
        options.model === false || type !== "classifier" || providerName !== "typesafe" || id !== "jev-latest" ? undefined : model,
      async classify(_model: unknown, context: { questions: Record<string, any> }, opts?: { signal?: AbortSignal }) {
        const call = { questions: context.questions, signal: opts?.signal };
        calls.push(call);
        if (options.classify) return options.classify(call);
        const answers = Object.fromEntries(Object.entries(context.questions).map(([id, question]) => {
          const value = answer(question.instructions, lineOf(question.instructions));
          if (question.type === "choice") {
            const choice = String(value);
            return [id, { type: "choice", choice, probabilities: { [choice]: 1 }, confidence: 1 }];
          }
          return [id, { type: "bool", probability: Number(value) }];
        }));
        return { api: "typesafe-system-one", provider: "typesafe", model: "jev-1.13.0", answers, stopReason: "stop", timestamp: 0 };
      },
    },
  };
}

function setup(dir: string, registry: unknown) {
  const emitter = new EventEmitter();
  const handlers = new Map<string, Array<(event: any, ctx: ExtensionContext) => any>>();
  const tools = new Map<string, any>();
  const pi = {
    events: { emit: (channel: string, value: unknown) => emitter.emit(channel, value),
      on: (channel: string, handler: (value: unknown) => void) => { emitter.on(channel, handler); return () => emitter.off(channel, handler); } },
    on: (event: string, handler: any) => { handlers.set(event, [...(handlers.get(event) ?? []), handler]); },
    registerTool: (tool: any) => { tools.set(tool.name, tool); },
    getSessionName: () => "Test session",
    exec: async () => ({ code: 1, stdout: "", stderr: "", killed: false }),
  } as unknown as ExtensionAPI;
  const ctx = {
    cwd: dir, hasUI: false, isIdle: () => true, getSystemPrompt: () => "",
    sessionManager: { getSessionId: () => "review", getSessionFile: () => path.join(dir, "review.jsonl") },
    modelRegistry: registry,
  } as unknown as ExtensionContext;
  plans(pi);
  provider(pi, { dataDir: dir });
  return {
    start: async () => { for (const handler of handlers.get("session_start") ?? []) await handler({ type: "session_start" }, ctx); },
    save: (content: string, signal?: AbortSignal) => tools.get("save_plan").execute("test", { title: "Sun", content }, signal, undefined, ctx),
  };
}

async function withSession(registry: unknown, run: (save: ReturnType<typeof setup>["save"]) => Promise<void>, key: string | null = "test-key") {
  const dir = await mkdtemp(path.join(tmpdir(), "pi-plan-review-"));
  const previous = process.env.TYPESAFE_API_KEY;
  if (key === null) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = key;
  try {
    const session = setup(dir, registry);
    await session.start();
    await run(session.save);
  } finally {
    if (previous === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = previous;
    await rm(dir, { recursive: true, force: true });
  }
}

const handBuilt: Answer = (question, line) => {
  if (question.includes("What does this line do")) return "proposes_work";
  if (question.includes("something by hand") && line === HAND_BUILT) return 0.8;
  return 0.1;
};

test("a saved plan reports a line that rebuilds what an existing library does", async () => {
  const { registry } = fakeRegistry(handBuilt);
  await withSession(registry, async (save) => {
    const result = await save(PLAN);
    const text = result.content[0].text;
    assert.match(text, /^Saved plan "Sun"/);
    assert.match(text, /Jev plan review:/);
    assert.ok(text.includes(HAND_BUILT));
    assert.ok(!text.includes(TOGGLE));
    assert.equal(await readFile(result.details.plan.path, "utf8"), PLAN);
    assert.deepEqual(result.details.review.findings.map((finding: any) => [finding.kind, finding.line]), [["existing_tool", HAND_BUILT]]);
  });
});

test("without TYPESAFE_API_KEY the plan is saved as before and Jev is not called", async () => {
  const { registry, calls } = fakeRegistry(handBuilt);
  await withSession(registry, async (save) => {
    const result = await save(PLAN);
    assert.equal(calls.length, 0);
    assert.doesNotMatch(result.content[0].text, /Jev/);
    assert.equal(result.details.review, undefined);
  }, null);
});

test("a line that already adopts a library is not reported as rebuilding it", async () => {
  const { registry } = fakeRegistry((question, line) => {
    if (question.includes("itself propose using")) return line === HAND_BUILT ? 0.95 : 0.1;
    return handBuilt(question, line);
  });
  await withSession(registry, async (save) => {
    const result = await save(PLAN);
    assert.doesNotMatch(result.content[0].text, /Jev/);
    assert.deepEqual(result.details.review.findings, []);
  });
});

test("only lines that propose work can produce findings", async () => {
  const { registry } = fakeRegistry((question, line) => {
    if (question.includes("What does this line do")) return line === HAND_BUILT ? "other" : "proposes_work";
    return handBuilt(question, line);
  });
  await withSession(registry, async (save) => {
    assert.deepEqual((await save(PLAN)).details.review.findings, []);
  });
});

test("a component a simpler design could avoid is reported from 0.7", async () => {
  const avoidable = (probability: number): Answer => (question, line) => {
    if (question.includes("What does this line do")) return "proposes_work";
    if (question.includes("simpler design could avoid") && line === TOGGLE) return probability;
    return 0.1;
  };
  await withSession(fakeRegistry(avoidable(0.75)).registry, async (save) => {
    const result = await save(PLAN);
    assert.deepEqual(result.details.review.findings.map((finding: any) => [finding.kind, finding.line]), [["simpler_design", TOGGLE]]);
    assert.match(result.content[0].text, /May be simpler without this part \(0\.75\)/);
  });
  await withSession(fakeRegistry(avoidable(0.65)).registry, async (save) => {
    assert.deepEqual((await save(PLAN)).details.review.findings, []);
  });
});

const stalledClassify = (call: Call) => new Promise((resolve) => call.signal!.addEventListener("abort", () => resolve({ answers: {}, stopReason: "aborted" })));

test("a failed Jev keeps the normal save result and records why", async () => {
  const failed = fakeRegistry(handBuilt, { classify: async () => ({ answers: {}, stopReason: "error", errorMessage: "Provider is not configured: typesafe" }) });
  await withSession(failed.registry, async (save) => {
    const result = await save(PLAN);
    assert.match(result.content[0].text, /^Saved plan "Sun" to session context at .*\)\.$/);
    assert.deepEqual(result.details.review, { error: "Provider is not configured: typesafe" });
    assert.equal(await readFile(result.details.plan.path, "utf8"), PLAN);
  });
});

test("a Jev review that passes its deadline reports a timeout", async () => {
  const stalled = fakeRegistry(handBuilt, { classify: stalledClassify });
  await withSession(stalled.registry, async () => {
    assert.deepEqual(await reviewPlan(PLAN, stalled.registry as any, undefined, 20), { error: "timed out" });
  });
});

test("a cancelled, unavailable, or unsupported Jev saves the plan without a review", async () => {
  const stalled = fakeRegistry(handBuilt, { classify: stalledClassify });
  const missing = fakeRegistry(handBuilt, { model: false });
  for (const [registry, signal] of [[stalled.registry, AbortSignal.timeout(20)], [missing.registry], [undefined]] as const) {
    await withSession(registry, async (save) => {
      const result = await save(PLAN, signal);
      assert.match(result.content[0].text, /^Saved plan "Sun" to session context at .*\)\.$/);
      assert.equal(result.details.review, undefined);
      assert.equal(await readFile(result.details.plan.path, "utf8"), PLAN);
    });
  }
  assert.equal(missing.calls.length, 0);
});
