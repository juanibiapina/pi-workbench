import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

type Registry = ExtensionContext["modelRegistry"];
export type Classifier = Pick<Registry, "findOfType" | "classify">;
type Questions = Parameters<Registry["classify"]>[1]["questions"];

export type Finding = { kind: "existing_tool" | "simpler_design"; line: string; probability: number };
export type PlanReview =
  | { model: string; findings: Finding[]; scores: Record<string, Record<string, number>> }
  | { error: string };

const TIMEOUT_MS = 5000;
const MAX_LINES = 250;
const MAX_FINDINGS = 3;
const QUESTIONS_PER_CALL = 120;

const WORK = "proposes_work";
const YES_NO = { true: "Yes", false: "No" };
const QUESTIONS = {
  hand_built: "Does this line choose to write something by hand that an existing library, tool, package, or platform feature already provides? Answer No when the line rejects or only mentions the hand-built option.",
  from_scratch: "Does this line choose to implement a known algorithm, format, protocol, or parser from scratch? Answer No when the line rejects or only mentions doing so.",
  adopts_existing: "Does this line itself propose using an existing library, tool, package, or platform feature?",
  avoidable_part: "Does this line add a component (process, service, cache, protocol, file format, configuration section, or abstraction) that a simpler design could avoid?",
};
type SetName = keyof typeof QUESTIONS;

const RULES: Array<{ kind: Finding["kind"]; threshold: number; probability: (score: (set: SetName) => number) => number }> = [
  { kind: "existing_tool", threshold: 0.6, probability: (s) => s("adopts_existing") >= 0.8 ? 0 : Math.max(s("hand_built"), s("from_scratch")) },
  { kind: "simpler_design", threshold: 0.7, probability: (s) => s("avoidable_part") },
];

const MESSAGES: Record<Finding["kind"], { label: string; advice: string }> = {
  existing_tool: { label: "May reuse an existing library or tool", advice: "Check for a maintained library, package, or platform feature before building this by hand." },
  simpler_design: { label: "May be simpler without this part", advice: "Consider a design that reaches the goal without this component." },
};

function planLines(content: string): string[] {
  const lines: string[] = [];
  let code: string[] | undefined;
  for (const raw of content.split("\n")) {
    const line = raw.trimEnd();
    if (/^\s*```/.test(line)) {
      if (code) { if (code.length) lines.push(code.join("\n")); code = undefined; } else code = [];
      continue;
    }
    if (code) { code.push(line); continue; }
    if (!line.trim() || /^#{1,6}\s/.test(line) || /^\s*\|?\s*:?-{3,}/.test(line)) continue;
    const continuation = /^\s{2,}\S/.test(line) && !/^\s*([-*+]|\d+\.)\s/.test(line);
    if (continuation && lines.length) lines[lines.length - 1] += ` ${line.trim()}`;
    else lines.push(line.trim().replace(/^([-*+]|\d+\.)\s+/, ""));
  }
  return lines.slice(0, MAX_LINES);
}

const MAX_LINE_CHARS = 1200;
const instructions = (line: string, question: string) => `Line: ${JSON.stringify(line.slice(0, MAX_LINE_CHARS))}\n\n${question}`;
const KIND = {
  type: "choice" as const,
  question: "What does this line do in the plan?",
  criteria: {
    [WORK]: "Says something to build, change, add, remove, or configure, or decides how to build it, including an alternative it rejects and what it does instead.",
    other: "Background, evidence, tests, acceptance checks, work left out of scope, or process notes.",
  },
};

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type Model = Parameters<Registry["classify"]>[0];

async function askLines(classifier: Classifier, model: Model, plan: string, lines: string[], indexes: number[], question: Questions[string] | ((line: string) => Questions[string]), signal: AbortSignal) {
  const questions: Questions = Object.fromEntries(indexes.map((i) => [`L${i}`, typeof question === "function" ? question(lines[i]) : question]));
  const result = await classifier.classify(model, { state: { plan }, questions }, { signal });
  if (result.stopReason !== "stop") throw new Error(result.errorMessage ?? result.stopReason);
  const values = new Map<number, number>();
  for (const i of indexes) {
    const answer = result.answers[`L${i}`];
    if (answer?.type === "choice") values.set(i, answer.probabilities[WORK] ?? 0);
    else if (answer?.type === "bool") values.set(i, answer.probability);
    else throw new Error(`Missing answer L${i}`);
  }
  return { values, model: result.model };
}

const MAX_ERROR_CHARS = 120;

export async function reviewPlan(content: string, classifier: Classifier, signal?: AbortSignal, timeoutMs = TIMEOUT_MS): Promise<PlanReview | undefined> {
  if (!process.env.TYPESAFE_API_KEY || typeof classifier?.classify !== "function") return undefined;
  const model = classifier.findOfType("classifier", "typesafe", "jev-latest");
  const lines = planLines(content);
  if (!model || !lines.length) return undefined;
  const timeout = AbortSignal.timeout(timeoutMs);
  try {
    const deadline = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const sets: Record<string, (line: string) => Questions[string]> = {
      kind: (line) => ({ type: KIND.type, instructions: instructions(line, KIND.question), criteria: KIND.criteria }),
      ...Object.fromEntries(Object.entries(QUESTIONS).map(([name, question]) =>
        [name, (line: string) => ({ type: "bool" as const, instructions: instructions(line, question), criteria: YES_NO })])),
    };
    const groups = chunks(lines.map((_, i) => i), QUESTIONS_PER_CALL);
    const answers = await Promise.all(Object.entries(sets).flatMap(([name, question]) =>
      groups.map(async (group) => ({ name, ...(await askLines(classifier, model, content, lines, group, question, deadline)) }))));
    const scores: Record<string, Record<string, number>> = {};
    for (const { name, values } of answers) for (const [i, value] of values) (scores[name] ??= {})[`L${i}`] = value;
    const work = lines.map((_, i) => i).filter((i) => scores.kind[`L${i}`] >= 0.5);
    const findings = RULES.flatMap((rule) => work
      .map((i) => ({ kind: rule.kind, line: lines[i], probability: rule.probability((set) => scores[set][`L${i}`]) }))
      .filter((finding) => finding.probability >= rule.threshold)
      .sort((a, b) => b.probability - a.probability)
      .slice(0, MAX_FINDINGS));
    return { model: answers[0].model, findings, scores };
  } catch (error) {
    if (signal?.aborted) return undefined;
    if (timeout.aborted) return { error: "timed out" };
    const message = error instanceof Error ? error.message : String(error);
    return { error: message.replace(/\s+/g, " ").trim().slice(0, MAX_ERROR_CHARS) || "unknown error" };
  }
}

export function reviewStatus(review: PlanReview): string {
  if ("error" in review) return `Jev: review failed (${review.error})`;
  const count = review.findings.length;
  return count ? `Jev: ${count} finding${count === 1 ? "" : "s"}` : "Jev: no findings";
}

const quote = (line: string) => {
  const flat = line.replace(/\s+/g, " ");
  return flat.length > 120 ? `${flat.slice(0, 119)}…` : flat;
};

export function findingLine(finding: Finding): string {
  return `${MESSAGES[finding.kind].label} (${finding.probability.toFixed(2)}): "${quote(finding.line)}"`;
}

export function formatReview(review: Extract<PlanReview, { findings: Finding[] }>): string {
  return [
    "Jev plan review:",
    ...review.findings.flatMap((finding) => [`- ${findingLine(finding)}`, `  ${MESSAGES[finding.kind].advice}`]),
    "Mention these findings to the user before implementing.",
  ].join("\n");
}
