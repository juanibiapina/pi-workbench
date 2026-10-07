import { homedir } from "node:os";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { getCapabilities, hyperlink, Spacer, Text, TruncatedText } from "@earendil-works/pi-tui";
import { createContributor } from "@juanibiapina/pi-session-context/client";
import { planUrl } from "./browser-url.ts";
import { findingLine, formatReview, reviewPlan, reviewStatus, type PlanReview } from "./plan-review.ts";

type Plan = { id: string; title: string; path: string };
const displayPath = (value: string) => value.startsWith(`${homedir()}/`) ? `~${value.slice(homedir().length)}` : value;
const linkPath = (label: string, value: string) =>
  isAbsolute(value) && getCapabilities().hyperlinks ? hyperlink(label, pathToFileURL(value).href) : label;
const resultText = (result: { content: Array<{ type: string; text?: string }> }) =>
  result.content.find((item) => item.type === "text")?.text ?? "Operation failed";
const plans = (value: unknown): Plan[] => {
  if (value === undefined) return [];
  const data = value as { plans?: unknown };
  if (!data || !Array.isArray(data.plans)) throw new Error("Invalid saved plans");
  return data.plans as Plan[];
};
export function register(pi: ExtensionAPI): void {
  const session = createContributor(pi, "pi-plans");
  pi.registerTool({
    name: "save_plan", label: "Save Plan",
    description: "Save a finished Markdown plan to this session and return its editable path. Use ordinary Read and Edit tools for later changes.",
    parameters: Type.Object({ title: Type.String(), content: Type.String() }),
    async execute(_id, { title, content }, signal, _update, ctx) {
      if (!title.trim() || !content.trim() || /[\r\n]/.test(title)) throw new Error("Plan title and content must not be blank; title must be one line");
      if (Buffer.byteLength(title, "utf8") > 4096) throw new Error("Plan title exceeds 4096 bytes");
      const attachment = await session.createAttachment(ctx, content, (current, saved) => {
        const previous = plans(current);
        const sessionFile = ctx.sessionManager.getSessionFile()!;
        const plan = { id: saved.id, title, path: `${sessionFile.split("/").at(-1)}.plans/${saved.id}.md` };
        return { plans: [...previous, plan] };
      });
      const plan = { id: attachment.id, title, path: attachment.path };
      const review = await reviewPlan(content, ctx.modelRegistry, signal);
      const saved = `Saved plan "${title}" to session context at ${plan.path} (ID: ${plan.id}).`;
      const text = review && "findings" in review && review.findings.length ? `${saved}\n\n${formatReview(review)}` : saved;
      return { content: [{ type: "text", text }], details: { sessionId: ctx.sessionManager.getSessionId(), plan, ...(review ? { review } : {}) } };
    },
    renderCall(args, theme) {
      return new TruncatedText(theme.fg("toolTitle", theme.bold("save_plan ")) + theme.fg("accent", args?.title ?? "…"));
    },
    renderResult(result, { expanded, isPartial }, theme, context) {
      if (context.isError) return new Text(theme.fg("error", resultText(result)), 0, 0);
      const details = result.details as { sessionId?: string; plan?: Plan; review?: PlanReview } | undefined;
      const review = details?.review;
      const findings = review && "findings" in review ? review.findings : [];
      const count = review ? theme.fg(findings.length || "error" in review ? "warning" : "muted", reviewStatus(review)) : "";
      if (!expanded) return count ? new Text(count, 0, 0) : new Spacer(0);
      if (isPartial) return new Text(theme.fg("warning", "Saving plan…"), 0, 0);
      const plan = details?.plan;
      if (!plan) return new TruncatedText(theme.fg("toolOutput", resultText(result)));
      const shownPath = displayPath(plan.path);
      let browser = "";
      try {
        const url = planUrl(details?.sessionId ?? "", plan.id);
        browser = `\n${getCapabilities().hyperlinks ? hyperlink(theme.fg("accent", "Open in browser"), url) : theme.fg("accent", url)}`;
      } catch { /* A bad browser configuration must not affect the Markdown result. */ }
      const quotes = findings.map((finding) => `\n${theme.fg("warning", `- ${findingLine(finding)}`)}`).join("");
      return new Text(`${theme.fg("muted", `ID: ${plan.id}`)}\n${theme.fg("muted", "Path: ")}${linkPath(theme.fg("accent", shownPath), plan.path)}${browser}${count ? `\n${count}` : ""}${quotes}`, 0, 0);
    },
  });
  pi.registerTool({
    name: "delete_plan", label: "Delete Plan",
    description: "Delete a saved plan and its Markdown file. Use get_session_context to find its exact plan ID.",
    parameters: Type.Object({ planId: Type.String() }),
    async execute(_id, { planId }, _signal, _update, ctx) {
      let removed: Plan | undefined;
      await session.deleteAttachment(ctx, planId, (current) => {
        const previous = plans(current);
        removed = previous.find((item) => item.id === planId);
        if (!removed) throw new Error(`Plan not found in this session: ${planId}`);
        return { plans: previous.filter((item) => item.id !== planId) };
      });
      return { content: [{ type: "text", text: `Deleted plan "${removed!.title}" (${planId}) from session context.` }], details: { sessionId: ctx.sessionManager.getSessionId(), plan: removed! } };
    },
    renderCall(args, theme) {
      return new TruncatedText(theme.fg("toolTitle", theme.bold("delete_plan ")) + theme.fg("accent", args?.planId ?? "…"));
    },
    renderResult(result, { expanded, isPartial }, theme, context) {
      if (context.isError) return new Text(theme.fg("error", resultText(result)), 0, 0);
      if (!expanded) return new Spacer(0);
      if (isPartial) return new Text(theme.fg("warning", "Deleting plan…"), 0, 0);
      const plan = (result.details as { plan?: Plan } | undefined)?.plan;
      if (!plan) return new TruncatedText(theme.fg("toolOutput", resultText(result)));
      return new Text(`${theme.fg("muted", "Title: ")}${theme.fg("accent", plan.title)}\n${theme.fg("muted", `ID: ${plan.id}`)}\n${theme.fg("muted", `Path: ${plan.path}`)}`, 0, 0);
    },
  });
}
export default register;
