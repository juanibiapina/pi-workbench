import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { createContributor } from "@juanibiapina/pi-session-context/client";

type Plan = { id: string; title: string; path: string };
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
    async execute(_id, { title, content }, _signal, _update, ctx) {
      if (!title.trim() || !content.trim() || /[\r\n]/.test(title)) throw new Error("Plan title and content must not be blank; title must be one line");
      if (Buffer.byteLength(title, "utf8") > 4096) throw new Error("Plan title exceeds 4096 bytes");
      const attachment = await session.createAttachment(ctx, content, (current, saved) => {
        const previous = plans(current);
        const sessionFile = ctx.sessionManager.getSessionFile()!;
        const plan = { id: saved.id, title, path: `${sessionFile.split("/").at(-1)}.plans/${saved.id}.md` };
        return { plans: [...previous, plan] };
      });
      const plan = { id: attachment.id, title, path: attachment.path };
      return { content: [{ type: "text", text: `Saved plan "${title}" to session context at ${plan.path} (ID: ${plan.id}).` }], details: { sessionId: ctx.sessionManager.getSessionId(), plan } };
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
  });
}
export default register;
