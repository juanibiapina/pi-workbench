import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { findingLine, reviewPlan, type PlanReview } from "../packages/pi-plans/src/plan-review.ts";

const { values: options } = parseArgs({
  options: {
    sessions: { type: "string", default: path.join(homedir(), ".pi/agent/sessions") },
    out: { type: "string", default: "plan-review-replay.json" },
    concurrency: { type: "string", default: "4" },
  },
});

type Plan = { title: string; content: string; session: string };

async function savedPlans(dir: string): Promise<Plan[]> {
  const plans = new Map<string, Plan>();
  const files = (await readdir(dir, { recursive: true })).filter((file) => file.endsWith(".jsonl"));
  for (const file of files.sort()) {
    for (const line of (await readFile(path.join(dir, file), "utf8")).split("\n")) {
      if (!line.includes('"save_plan"')) continue;
      const content = JSON.parse(line).message?.content;
      if (!Array.isArray(content)) continue;
      for (const item of content) {
        if (item.type !== "toolCall" || item.name !== "save_plan" || typeof item.arguments?.content !== "string") continue;
        const key = createHash("sha256").update(item.arguments.content).digest("hex");
        if (!plans.has(key)) plans.set(key, { title: item.arguments.title, content: item.arguments.content, session: file });
      }
    }
  }
  return [...plans.values()];
}

const registry = new ModelRegistry(await ModelRuntime.create());
const plans = await savedPlans(options.sessions);
const results: Array<Plan & { review?: PlanReview }> = [];
let next = 0;
await Promise.all(Array.from({ length: Number(options.concurrency) }, async () => {
  while (next < plans.length) {
    const plan = plans[next++];
    results.push({ ...plan, review: await reviewPlan(plan.content, registry, undefined, 60_000) });
    process.stderr.write(`\r${results.length}/${plans.length}`);
  }
}));
process.stderr.write("\n");

const reviewed = results.filter((result) => result.review && "findings" in result.review);
const failed = results.filter((result) => result.review && "error" in result.review);
const findings = reviewed.flatMap((result) => "findings" in result.review! ? result.review.findings.map((finding) => ({ title: result.title, finding })) : []);
await writeFile(options.out, JSON.stringify(results, null, 2));

console.log(`Plans: ${plans.length}, reviewed: ${reviewed.length}, failed: ${failed.length}, skipped: ${results.length - reviewed.length - failed.length}`);
console.log(`Plans with findings: ${reviewed.filter((result) => "findings" in result.review! && result.review.findings.length).length}`);
for (const kind of ["existing_tool", "simpler_design"]) console.log(`${kind}: ${findings.filter(({ finding }) => finding.kind === kind).length}`);
for (const result of failed) if ("error" in result.review!) console.log(`Failed: ${result.title}: ${result.review.error}`);
for (const { title, finding } of findings) console.log(`- [${title}] ${findingLine(finding)}`);
console.log(`Report: ${options.out}`);
