/**
 * Claude as the game's designer. Given a player's words ("an ancient obsidian salamander with six
 * stubby legs and glowing magma cracks..."), Claude writes a design in the shape language, checks
 * it against the world's rules, renders it and looks at the render, fixes what's wrong, and saves
 * it to the world, the same loop an agent runs through the MCP server, run by the server itself.
 *
 * In game: /imagine <description> (when ANTHROPIC_API_KEY is set). The design is then summoned
 * like any other: it pays the tier's cost and arrives as a world event; anyone can summon it again
 * with /summon design:<id>.
 */
import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_STANDARDS, critiqueDesign, designGuide, interpretPrompt, type DesignInput, type Standards } from "@lfg/shared";
import type { ServerModule } from "./kernel";
import type { Caster } from "./modules/vanilla/progression";
import type { SummonService } from "./modules/vanilla/summons";
import type { DesignRenderer } from "./render";

type Beta = Anthropic.Beta.Messages.BetaMessageParam;
type BetaTool = Anthropic.Beta.Messages.BetaTool;
type BetaToolResult = Anthropic.Beta.Messages.BetaToolResultBlockParam;

const MODEL = "claude-opus-5-5";

/** docs/AGENT-BEST-PRACTICES.md: the same guide agents read through MCP. */
let practices: string | null = null;
const bestPractices = () => (practices ??= (() => {
  try { return readFileSync(new URL("../../../docs/AGENT-BEST-PRACTICES.md", import.meta.url), "utf8"); } catch { return ""; }
})());

const INSTRUCTIONS = `You are the designer for LFG2, a shared voxel world where players summon creatures by describing them.
A player has described something; make it, as a design in the game's shape language (the guide below), so that what appears in the world is unmistakably what they asked for, down to the details they named.

How to work:
- Start from the brief and starting design you're given (they come from the game's bestiary and design skills) when they fit; replace them when the request is something they don't cover.
- check_design after each change: fix every error (the path says where, the hint how). Warnings and the critique are advice: follow them unless the request says otherwise.
- render_design and look at the image critically: proportions, silhouette, whether each detail the player named is visible, whether parts float or intersect badly, colours. Fix and render again until it reads well. Two or three renders is typical.
- When it passes and looks right, save_design. That ends the job; say nothing after it.

Stay within the world's rules (they are enforced anyway): its palette colours, triangle budgets and size limits. If the request can't be met (too big for the rules, or not something that can be made), make the closest thing that can and say so in the design's description.`;

const DESIGN_SCHEMA = { type: "object" as const, properties: { design: { type: "object" as const, description: "The full design JSON (name, description, movement, temperament, length, colors, gait, surface, shape: { parts: [...] })" } }, required: ["design"] };
const TOOLS: BetaTool[] = [
  { name: "check_design", description: "Check a design against every rule a summon gets (fields, shape, size, colours, triangle budget, a playtest), plus a critique against the player's words. Returns issues with JSON paths and hints. Free.", input_schema: DESIGN_SCHEMA },
  { name: "render_design", description: "Render a design as players will see it in this world: 3/4 front, side, front, top, a 20 m silhouette, and next to a player and a tree, with the check report. Look at it before saving. `pose` (seconds) shows it mid-animation.", input_schema: { ...DESIGN_SCHEMA, properties: { ...DESIGN_SCHEMA.properties, pose: { type: "number", description: "Optional: pose it mid-animation at this many seconds" } } } },
  { name: "save_design", description: "Save the finished design to the world (it must pass check_design). This ends the job.", input_schema: DESIGN_SCHEMA },
];

/** The rule values that change how a design looks (palette and model style), for the renderer. */
function lookRules(std: Standards): [string, number | boolean | string][] {
  const out: [string, number | boolean | string][] = [];
  for (const [k, v] of Object.entries(std.art.palette)) if (v !== (DEFAULT_STANDARDS.art.palette as Record<string, string>)[k]) out.push([`art.palette.${k}`, v]);
  const style = (std.art as { modelStyle?: string }).modelStyle;
  if (style) out.push(["art.modelStyle", style]);
  return out;
}

export interface DesignJob {
  prompt: string;
  author: string;
  std: Standards;
  summons: SummonService;
  onProgress?: (note: string) => void;
}

export type DesignResult = { ok: true; id: string; name: string; renders: number; checks: number } | { ok: false; error: string };

export class ClaudeDesigner {
  private client = new Anthropic();
  constructor(private opts: { renderer?: DesignRenderer; model?: string; maxTurns?: number }) {}

  /** A designer when the environment has Anthropic credentials, else null (the feature stays off). */
  static fromEnv(env: NodeJS.ProcessEnv, renderer?: DesignRenderer): ClaudeDesigner | null {
    if (!env.ANTHROPIC_API_KEY && !env.ANTHROPIC_AUTH_TOKEN) return null;
    return new ClaudeDesigner({ renderer, model: env.DESIGNER_MODEL || MODEL, maxTurns: Number(env.DESIGNER_MAX_TURNS ?? 16) });
  }

  async design(job: DesignJob): Promise<DesignResult> {
    const { prompt, std, summons } = job;
    const say = job.onProgress ?? (() => {});
    const interpreted = interpretPrompt(prompt, std);
    const start = "error" in interpreted ? null : { brief: interpreted.brief, start: interpreted.start };
    // Stable content first (instructions, guide, practices) so it caches across turns and jobs.
    const system: Anthropic.Beta.Messages.BetaTextBlockParam[] = [
      { type: "text", text: INSTRUCTIONS },
      { type: "text", text: `# The design guide (format, primitives, palette, budgets, example)\n${JSON.stringify(designGuide(std))}` },
      { type: "text", text: `# Best practices\n${bestPractices()}`, cache_control: { type: "ephemeral" } },
    ];
    const messages: Beta[] = [{
      role: "user",
      content: `The player ${job.author} asked for: "${prompt}"\n\n${start ? `The game's art director read it as:\n${JSON.stringify(start.brief)}\n\nA starting design from the design skills:\n${JSON.stringify(start.start)}` : "The bestiary has nothing for this; design it from the guide."}\n\nMake it, check it, render it, refine it, and save it.`,
    }];
    let renders = 0, checks = 0;
    const critique = (design: unknown, c: ReturnType<SummonService["designs"]["check"]>) =>
      c.model && !("error" in interpreted) ? critiqueDesign(design as DesignInput, c.model, interpreted.brief, std) : undefined;
    const summary = (design: unknown) => {
      const c = summons.designs.check(design);
      return { c, text: JSON.stringify({ ok: c.ok, issues: c.issues, errors: c.report?.errors ?? [], warnings: c.report?.warnings ?? [], tier: c.tier, triangles: c.report ? `${c.report.stats.triangles} (${c.report.stats.budget} ≤ ${c.report.stats.maxTriangles})` : undefined, size: c.report?.stats.size, playtest: c.playtest, critique: critique(design, c) }) };
    };

    for (let turn = 0; turn < (this.opts.maxTurns ?? 16); turn++) {
      const response = await this.client.beta.messages.stream({
        model: this.opts.model ?? MODEL,
        max_tokens: 64000,
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
        // If the model declines, Anthropic re-runs the request on its recommended fallback model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system,
        tools: TOOLS,
        messages,
      }).finalMessage();
      if (response.stop_reason === "refusal") return { ok: false, error: "the designer declined this request" };
      messages.push({ role: "assistant", content: response.content });
      const uses = response.content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use");
      if (!uses.length) return { ok: false, error: "the designer stopped without saving a design" };
      const results: BetaToolResult[] = [];
      for (const use of uses) {
        const input = use.input as { design?: unknown; pose?: number };
        if (!input || typeof input.design !== "object" || input.design === null) {
          results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: "`design` must be the design as a JSON object" });
          continue;
        }
        if (use.name === "check_design") {
          checks++;
          say(`checking (${checks})…`);
          results.push({ type: "tool_result", tool_use_id: use.id, content: summary(input.design).text });
        } else if (use.name === "render_design") {
          const { c, text } = summary(input.design);
          if (!c.spec || !this.opts.renderer) {
            results.push({ type: "tool_result", tool_use_id: use.id, is_error: !c.spec, content: c.spec ? `rendering isn't available here; the check: ${text}` : text });
            continue;
          }
          renders++;
          say(`looking at render ${renders}…`);
          try {
            const r = await this.opts.renderer.render(c.spec, lookRules(std), undefined, input.pose);
            results.push({ type: "tool_result", tool_use_id: use.id, content: [
              { type: "image", source: { type: "base64", media_type: "image/jpeg", data: r.jpeg.toString("base64") } },
              { type: "text", text },
            ] });
          } catch (e) {
            results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: `couldn't render: ${e instanceof Error ? e.message : String(e)}; the check: ${text}` });
          }
        } else if (use.name === "save_design") {
          const r = summons.designs.save(job.author, input.design);
          if (r.ok) return { ok: true, id: r.design.id, name: r.design.spec.name, renders, checks };
          results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: summary(input.design).text });
        } else {
          results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: `unknown tool ${use.name}` });
        }
      }
      messages.push({ role: "user", content: results });
    }
    return { ok: false, error: "the designer ran out of turns before saving" };
  }
}

/**
 * /imagine <description>: Claude designs it, saves it to the world and summons it for the player
 * (paying the tier's cost, as a world event). One design at a time per player.
 */
export function imagineModule(designer: ClaudeDesigner | null): ServerModule {
  return {
    id: "imagine", name: "Imagine", version: "1.0.0", author: "LFG2",
    description: "Claude designs what players describe (/imagine), when the server has an Anthropic API key",
    setup(api) {
      const busy = new Set<string>();
      api.command({
        name: "imagine",
        usage: "/imagine <a detailed description>",
        help: "Claude designs exactly what you describe, saves it to this world and summons it",
        admin: false,
        run(p, args) {
          if (!p) return "Players only";
          if (!designer) return "Imagining needs the server to have an Anthropic API key (ANTHROPIC_API_KEY). /summon still works.";
          const prompt = args.join(" ").trim();
          if (prompt.length < 3) return "Describe what to make, e.g. /imagine an ancient obsidian salamander with glowing magma cracks";
          if (prompt.length > 1000) return "That's too long: keep it under 1000 characters";
          const summons = api.use<SummonService>("summons");
          if (!summons) return "Summons are switched off in this world";
          const key = p.name.toLowerCase();
          if (busy.has(key)) return "Claude is still working on your last one";
          busy.add(key);
          const started = Date.now();
          let last = 0;
          designer.design({
            prompt, author: p.name, std: api.std, summons,
            onProgress: (note) => { if (Date.now() - last > 4000) { last = Date.now(); api.tell(p, `✎ ${note}`); } },
          }).then((r) => {
            const secs = Math.round((Date.now() - started) / 1000);
            if (!r.ok) { api.tell(p, `✎ Couldn't imagine that: ${r.error}`); return; }
            api.tell(p, `✎ "${r.name}" is designed (${r.checks} checks, ${r.renders} renders, ${secs}s) and saved: /summon design:${r.id}`);
            const caster = api.use<Caster>("caster:summons");
            const online = api.playerByName(p.name);
            if (caster && online) api.tell(online, caster.cast(online, `design:${r.id}`, {}));
          }).catch((e) => {
            api.log(`imagine failed: ${e instanceof Error ? e.message : String(e)}`);
            api.tell(p, "✎ The designer couldn't be reached; try again in a moment");
          }).finally(() => busy.delete(key));
          return `✎ Claude is imagining "${prompt.slice(0, 80)}${prompt.length > 80 ? "…" : ""}" (this takes a minute or two)`;
        },
      });
    },
  };
}
