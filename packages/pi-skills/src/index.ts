import { formatSkillsForPrompt, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { createContributor } from "@juanibiapina/pi-session-context/client";
import { loadSkill, skillCatalogSection } from "./skills.ts";

export function register(pi: ExtensionAPI): void {
  const session = createContributor(pi, "pi-skills");
  const load = (ctx: ExtensionContext, source: string, force: boolean) => loadSkill(pi, ctx, source, force, async (name, filePath) => {
    await session.updateSession(ctx, (current) => {
      const data = current === undefined ? { skills: [] as string[], skillPaths: {} as Record<string, string> } :
        current as { skills: string[]; skillPaths?: Record<string, string> };
      if (!Array.isArray(data.skills)) throw new Error("Invalid saved skills");
      return { skills: data.skills.includes(name) ? data.skills : [...data.skills, name], skillPaths: { ...data.skillPaths, [name]: filePath } };
    });
  });
  pi.on("before_agent_start", (event) => {
    const available = event.systemPromptOptions.skills ?? [];
    const section = skillCatalogSection(available);
    const options = event.systemPromptOptions;
    if ("sections" in options && options.sections && typeof options.sections === "object") {
      (options.sections as Record<string, string>).skills = section;
      return;
    }
    const previous = formatSkillsForPrompt(available);
    return { systemPrompt: previous && event.systemPrompt.includes(previous)
      ? event.systemPrompt.replace(previous, `\n\n${section}`)
      : `${event.systemPrompt}\n\n${section}` };
  });
  pi.on("input", async (event, ctx) => {
    if (!event.text.startsWith("/skill:")) return { action: "continue" };
    const space = event.text.indexOf(" ");
    const name = space === -1 ? event.text.slice(7) : event.text.slice(7, space);
    const args = space === -1 ? "" : event.text.slice(space + 1).trim();
    try {
      const block = await load(ctx, name, false);
      return { action: "transform", text: args ? `${block}\n\n${args}` : block };
    } catch (error) {
      const message = `Could not load skill ${name}: ${String(error)}`;
      if (ctx.hasUI) ctx.ui.notify(message, "error"); else console.error(message);
      return { action: "handled" };
    }
  });
  pi.registerTool({
    name: "load_skill", label: "Load skill",
    description: "Load the full instructions of a discovered local skill by name, or a skill from a public GitHub URL. Records the loaded skill in the current Pi session. Use for every skill you apply. GitHub URL forms: repository, /tree/<ref>[/<path>], or /blob/<ref>/<path>/SKILL.md.",
    parameters: Type.Object({ source: Type.String(), force: Type.Optional(Type.Boolean()) }),
    async execute(_id, { source, force }, _signal, _update, ctx) {
      const block = await load(ctx, source, force === true);
      return { content: [{ type: "text", text: block }], details: { source } };
    },
  });
}
export default register;
