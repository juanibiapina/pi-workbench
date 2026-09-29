import { homedir } from "node:os";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { formatSkillsForPrompt, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { getCapabilities, hyperlink, Spacer, Text, TruncatedText } from "@earendil-works/pi-tui";
import { createContributor } from "@juanibiapina/pi-session-context/client";
import { loadSkill, skillCatalogSection } from "./skills.ts";

const displayPath = (value: string) => value.startsWith(`${homedir()}/`) ? `~${value.slice(homedir().length)}` : value;
const linkPath = (label: string, value: string) =>
  isAbsolute(value) && getCapabilities().hyperlinks ? hyperlink(label, pathToFileURL(value).href) : label;
export function register(pi: ExtensionAPI): void {
  const session = createContributor(pi, "pi-skills");
  const load = async (ctx: ExtensionContext, source: string, force: boolean) => {
    let skill: { name: string; filePath: string } | undefined;
    const block = await loadSkill(pi, ctx, source, force, async (name, filePath) => {
      await session.updateSession(ctx, (current) => {
        const data = current === undefined ? { skills: [] as string[], skillPaths: {} as Record<string, string> } :
          current as { skills: string[]; skillPaths?: Record<string, string> };
        if (!Array.isArray(data.skills)) throw new Error("Invalid saved skills");
        return { skills: data.skills.includes(name) ? data.skills : [...data.skills, name], skillPaths: { ...data.skillPaths, [name]: filePath } };
      });
      skill = { name, filePath };
    });
    if (!skill) throw new Error("Skill loaded without resolved identity");
    return { block, skill };
  };
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
      const { block } = await load(ctx, name, false);
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
      const { block, skill } = await load(ctx, source, force === true);
      return { content: [{ type: "text", text: block }], details: { source, ...skill } };
    },
    renderCall(args, theme) {
      return new TruncatedText(theme.fg("toolTitle", theme.bold("load_skill ")) + theme.fg("accent", args?.source ?? "…"));
    },
    renderResult(result, { expanded, isPartial }, theme, context) {
      const output = result.content.find((item) => item.type === "text")?.text;
      if (context.isError) return new Text(theme.fg("error", output ?? "Could not load skill"), 0, 0);
      if (!expanded) return new Spacer(0);
      if (isPartial) return new Text(theme.fg("warning", "Loading skill…"), 0, 0);
      const details = result.details as { name?: string; filePath?: string; source?: string } | undefined;
      const filePath = details?.filePath;
      const source = details?.source ?? context.args?.source;
      const lines = [...(source && source !== details?.name ? [theme.fg("muted", `Source: ${source}`)] : []),
        ...(filePath ? [theme.fg("muted", "File: ") + linkPath(theme.fg("accent", displayPath(filePath)), filePath)] : [])];
      if (output) {
        const all = output.split("\n");
        const body = all[0]?.startsWith("<skill ") ? all.slice(3, -1) : all;
        const preview = body.slice(0, 8);
        lines.push(...preview.map((line) => theme.fg("toolOutput", line)));
        if (body.length > preview.length) lines.push(theme.fg("muted", `… ${body.length - preview.length} more lines in SKILL.md`));
      }
      return new Text(lines.join("\n"), 0, 0);
    },
  });
}
export default register;
