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
import { DEFAULT_STANDARDS, levelForTier, tierForLevel, critiqueDesign, designGuide, interpretPrompt, type DesignInput, type Standards } from "@lfg/shared";
import type { ServerModule } from "./kernel";
import type { Caster, ProgressionService } from "./modules/vanilla/progression";
import type { SummonService } from "./modules/vanilla/summons";
import type { DesignRenderer } from "./render";

type Beta = Anthropic.Beta.Messages.BetaMessageParam;
type BetaTool = Anthropic.Beta.Messages.BetaTool;
type BetaToolResult = Anthropic.Beta.Messages.BetaToolResultBlockParam;

/** docs/AGENT-BEST-PRACTICES.md: the same guide agents read through MCP. */
let practices: string | null = null;
const bestPractices = () => (practices ??= (() => {
  try { return readFileSync(new URL("../../../docs/AGENT-BEST-PRACTICES.md", import.meta.url), "utf8"); } catch { return ""; }
})());

const INSTRUCTIONS = `You are the designer for LFG2, a shared voxel world where players summon creatures by describing them.
A player has described something; make it, as a design in the game's shape language (the guide below), so that what appears in the world is unmistakably what they asked for, down to the details they named.

Work fast; players are waiting in the world:
- Prefer names to primitives: start from a \`base\` body and a \`kit\` of features from the guide's \`byName\` lists, and write your own \`shape\` parts only for what they don't cover (they're added to the base).
- Write the whole design once with render_design. It returns the check and an image: look at it critically (proportions, silhouette, whether each detail the player named is visible and attached, colours).
- Fix what you see with edit_design: small operations on the design you rendered, not a rewrite. Render again only if the fix was visual and risky.
- Then save_design. That ends the job; say nothing after it.
You have a small render budget; when it's used up, save.

Make it behave like what they described: the attacks it implies (abilities: bite, breath, shot, charge, stomp; and an element for breath and shots), and moving parts for what should move (a jaw for a mouth that opens, ears, antennae, tentacles: see the guide's animRoles).

Stay within the world's rules (they are enforced anyway): its palette colours, triangle budgets and size limits. If the request can't be met (too big for the rules, or not something that can be made), make the closest thing that can and say so in the design's description.`;

const POLISH = `You are polishing a first draft another designer made quickly. The player is already looking at it in the world.
Improve it in one pass: compare the render with the request, fix the biggest visible problems with edit_design (missing or unclear details, proportions, floating parts, colours), render once to confirm if the change was significant, then save_design. Keep its name and what already works; don't start over.`;

const DESIGN_ARG = { type: "object" as const, description: "The full design JSON (name, description, movement, temperament, length, colors, gait, surface, base, kit, shape: { parts: [...] })" };
const TOOLS: BetaTool[] = [
  { name: "render_design", description: "Set the whole design and look at it: returns the rule check (issues with JSON paths and hints, tier, triangle budget, a critique against the request) and a render as players will see it (3/4 front, side, front, top, a 20 m silhouette, next to a player and a tree). Use it for the first version; then use edit_design.", input_schema: { type: "object", properties: { design: DESIGN_ARG, pose: { type: "number", description: "Optional: pose it mid-animation at this many seconds" } }, required: ["design"] } },
  { name: "edit_design", description: "Change the current design with small operations instead of rewriting it, and get the check back (and a render if `render` is true and the budget allows). Paths are like \"colors.main\", \"kit\", \"shape.parts[2].shapes[0].size\". op \"set\" replaces the value at the path; \"add\" appends value to the array at the path (or inserts, when the path ends in [index]); \"remove\" deletes the array item or key at the path.", input_schema: { type: "object", properties: { ops: { type: "array", items: { type: "object", properties: { op: { type: "string", enum: ["set", "add", "remove"] }, path: { type: "string" }, value: {} }, required: ["op", "path"] } }, render: { type: "boolean" } }, required: ["ops"] } },
  { name: "save_design", description: "Save the current design to the world (it must pass the check). This ends the job.", input_schema: { type: "object", properties: {} } },
];

/** "shape.parts[2].shapes[0].size" → ["shape", "parts", 2, "shapes", 0, "size"]. */
function parsePath(path: string): (string | number)[] {
  const out: (string | number)[] = [];
  for (const m of path.matchAll(/([^.[\]]+)|\[(\d+)\]/g)) out.push(m[2] !== undefined ? Number(m[2]) : m[1]);
  return out;
}

/** Apply edit operations to a design (a copy); throws with a clear message when a path doesn't exist. */
export function applyEdits(design: unknown, ops: { op: string; path: string; value?: unknown }[]): unknown {
  const root = structuredClone(design) as Record<string, unknown>;
  for (const { op, path, value } of ops) {
    const keys = parsePath(path);
    if (!keys.length) throw new Error(`empty path in ${op}`);
    let parent: unknown = root;
    for (const k of keys.slice(0, -1)) {
      const next = (parent as Record<string | number, unknown>)?.[k];
      if (next === undefined || next === null || typeof next !== "object") {
        if (op === "set" && typeof k === "string") { (parent as Record<string, unknown>)[k] = {}; parent = (parent as Record<string, unknown>)[k]; continue; }
        throw new Error(`${path}: nothing at "${String(k)}"`);
      }
      parent = next;
    }
    const last = keys[keys.length - 1];
    const box = parent as Record<string | number, unknown> & unknown[];
    if (op === "set") box[last] = structuredClone(value);
    else if (op === "add") {
      if (Array.isArray(box) && typeof last === "number") box.splice(last, 0, structuredClone(value));
      else {
        const arr = box[last];
        if (arr === undefined) box[last] = [structuredClone(value)];
        else if (Array.isArray(arr)) arr.push(structuredClone(value));
        else throw new Error(`${path}: not a list, can't add to it`);
      }
    } else if (op === "remove") {
      if (Array.isArray(box) && typeof last === "number") { if (last >= box.length) throw new Error(`${path}: no item ${last}`); box.splice(last, 1); }
      else delete box[last];
    } else throw new Error(`unknown op "${op}"`);
  }
  return root;
}

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
  /** Start from this design (a remix of something close, or a draft to polish). */
  from?: { input: unknown; note: string };
  /** Keep this id when saving (a polish replaces its draft). */
  id?: string;
  onProgress?: (note: string) => void;
}

export type DesignResult = { ok: true; id: string; name: string; input: unknown; renders: number; turns: number; seconds: number } | { ok: false; error: string };

export interface Phase { model: string; effort: "low" | "medium" | "high"; maxRenders: number; maxTurns: number; system: string }

export class ClaudeDesigner {
  private client = new Anthropic();
  constructor(readonly opts: { renderer?: DesignRenderer; draft: Phase; polish: Phase | null }) {}

  /** A designer when the environment has Anthropic credentials, else null (the feature stays off). */
  static fromEnv(env: NodeJS.ProcessEnv, renderer?: DesignRenderer): ClaudeDesigner | null {
    if (!env.ANTHROPIC_API_KEY && !env.ANTHROPIC_AUTH_TOKEN) return null;
    const draftModel = env.DESIGNER_DRAFT_MODEL || "claude-sonnet-5-5";
    const polishModel = env.DESIGNER_POLISH_MODEL ?? "claude-opus-5-5";
    return new ClaudeDesigner({
      renderer,
      draft: { model: draftModel, effort: "medium", maxRenders: Number(env.DESIGNER_RENDERS ?? 2), maxTurns: 8, system: INSTRUCTIONS },
      // DESIGNER_POLISH_MODEL= (empty) turns the second pass off.
      polish: polishModel ? { model: polishModel, effort: "medium", maxRenders: 1, maxTurns: 8, system: `${INSTRUCTIONS}\n\n${POLISH}` } : null,
    });
  }

  /** The fast first pass. */
  draft(job: DesignJob): Promise<DesignResult> { return this.run(job, this.opts.draft); }
  /** The second pass, from a saved draft; saves over it (same id). */
  polish(job: DesignJob): Promise<DesignResult> { return this.opts.polish ? this.run(job, this.opts.polish) : Promise.resolve({ ok: false, error: "no polish pass configured" }); }

  private async run(job: DesignJob, phase: Phase): Promise<DesignResult> {
    const { prompt, std, summons } = job;
    const say = job.onProgress ?? (() => {});
    const interpreted = interpretPrompt(prompt, std);
    const t0 = Date.now();
    const log = (msg: string) => { if (process.env.DESIGNER_DEBUG) console.log(`[designer ${phase.model}] +${((Date.now() - t0) / 1000).toFixed(1)}s ${msg}`); };
    // Stable content first (instructions, guide, practices) so it caches across turns and jobs.
    const system: Anthropic.Beta.Messages.BetaTextBlockParam[] = [
      { type: "text", text: phase.system },
      { type: "text", text: `# The design guide (format, primitives, bases, kit, palette, budgets, example)\n${JSON.stringify(designGuide(std))}` },
      { type: "text", text: `# Best practices\n${bestPractices()}`, cache_control: { type: "ephemeral" } },
    ];
    const brief = "error" in interpreted ? null : interpreted;
    const opening = job.from
      ? `${job.from.note}\n${JSON.stringify(job.from.input)}`
      : brief ? `The game's art director read it as:\n${JSON.stringify(brief.brief)}\n\nA starting design from the bestiary (adapt it, or replace it with a base and kit that fit better):\n${JSON.stringify(brief.start)}` : "The bestiary has nothing for this; design it from the guide.";
    const messages: Beta[] = [{ role: "user", content: `The player ${job.author} asked for: "${prompt}"\n\n${opening}` }];
    let current: unknown = job.from?.input;
    let renders = 0;
    const critique = (design: unknown, c: ReturnType<SummonService["designs"]["check"]>) => {
      if (!c.model || !brief) return undefined;
      try { return critiqueDesign(design as DesignInput, c.model, brief.brief, std); } catch (e) { log(`critique failed: ${e instanceof Error ? e.stack : e}`); return undefined; }
    };
    const checkText = (design: unknown) => {
      const c = summons.designs.check(design);
      return { c, text: JSON.stringify({ ok: c.ok, issues: c.issues, errors: c.report?.errors ?? [], warnings: c.report?.warnings ?? [], tier: c.tier, triangles: c.report ? `${c.report.stats.triangles} (${c.report.stats.budget} ≤ ${c.report.stats.maxTriangles})` : undefined, size: c.report?.stats.size, playtest: c.playtest, critique: critique(design, c), rendersLeft: Math.max(0, phase.maxRenders - renders) }) };
    };
    const look = async (design: unknown, wantRender: boolean, pose?: number): Promise<BetaToolResult["content"]> => {
      const { c, text } = checkText(design);
      if (!wantRender || !c.spec || !this.opts.renderer) return text;
      if (renders >= phase.maxRenders) return `${text}\n(render budget used: save_design now if the check passes)`;
      renders++;
      say(`looking at it (${renders})…`);
      const tr = Date.now();
      const r = await this.opts.renderer.render(c.spec, lookRules(std), undefined, pose);
      log(`render ${renders}: ${((Date.now() - tr) / 1000).toFixed(1)}s`);
      return [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: r.jpeg.toString("base64") } }, { type: "text", text }];
    };
    const save = (): DesignResult | string => {
      if (current === undefined) return "nothing to save yet: render_design first";
      const input = job.id ? { ...(current as object), id: job.id } : current;
      const r = summons.designs.save(job.author, input);
      if (!r.ok) return checkText(input).text;
      return { ok: true, id: r.design.id, name: r.design.spec.name, input, renders, turns: 0, seconds: Math.round((Date.now() - t0) / 1000) };
    };

    for (let turn = 0; turn < phase.maxTurns; turn++) {
      const tm = Date.now();
      const response = await this.client.beta.messages.stream({
        model: phase.model,
        max_tokens: 32000,
        thinking: { type: "adaptive" },
        output_config: { effort: phase.effort },
        // If the model declines, Anthropic re-runs the request on its recommended fallback model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system,
        tools: TOOLS,
        messages,
      }).finalMessage();
      const u = response.usage;
      log(`turn ${turn + 1}: ${((Date.now() - tm) / 1000).toFixed(1)}s, ${u.output_tokens} out, ${u.cache_read_input_tokens ?? 0} cached, tools: ${response.content.filter((b) => b.type === "tool_use").map((b) => (b as { name: string }).name).join(",")}`);
      if (response.stop_reason === "refusal") return { ok: false, error: "the designer declined this request" };
      messages.push({ role: "assistant", content: response.content });
      const uses = response.content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use");
      if (!uses.length) break;
      const results: (BetaToolResult | Anthropic.Beta.Messages.BetaTextBlockParam)[] = [];
      for (const use of uses) {
        try {
          const input = (use.input ?? {}) as { design?: unknown; pose?: number; ops?: { op: string; path: string; value?: unknown }[]; render?: boolean };
          if (use.name === "render_design") {
            if (!input.design || typeof input.design !== "object") throw new Error("`design` must be the design as a JSON object");
            current = input.design;
            results.push({ type: "tool_result", tool_use_id: use.id, content: await look(current, true, input.pose) });
          } else if (use.name === "edit_design") {
            if (current === undefined) throw new Error("render_design the first version before editing it");
            if (!Array.isArray(input.ops) || !input.ops.length) throw new Error("`ops` must be a list of { op, path, value }");
            current = applyEdits(current, input.ops);
            say("refining…");
            results.push({ type: "tool_result", tool_use_id: use.id, content: await look(current, !!input.render) });
          } else if (use.name === "save_design") {
            const r = save();
            if (typeof r !== "string") return r.ok ? { ...r, turns: turn + 1 } : r;
            log(`save refused: ${r}\n${JSON.stringify(current)}`);
            results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: r });
          } else throw new Error(`unknown tool ${use.name}`);
        } catch (e) {
          // A bad edit or a design that trips the checker: tell Claude, don't end the job.
          log(`${use.name} failed: ${e instanceof Error ? e.message : e}`);
          results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: e instanceof Error ? e.message : String(e) });
        }
      }
      // Running out of turns: say so, or the work is lost to one more edit.
      const left = phase.maxTurns - turn - 1;
      if (left <= 2) results.push({ type: "text", text: left === 1 ? "This is your last turn: call save_design now." : `${left} turns left: finish your edits and save_design.` });
      messages.push({ role: "user", content: results });
    }
    // Out of turns (or stopped talking): keep the last version if it passes.
    const r = save();
    return typeof r === "string" ? { ok: false, error: "the designer didn't get to a design that passes" } : r.ok ? { ...r, turns: phase.maxTurns } : r;
  }
}

/** "An ancient, obsidian Salamander!" → "ancient obsidian salamander": how prompts are remembered. */
export function promptKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w && !["a", "an", "the", "some", "please", "me"].includes(w)).join(" ");
}
/** How alike two remembered prompts are (shared words over all words). */
function likeness(a: string, b: string): number {
  const A = new Set(a.split(" ")), B = new Set(b.split(" "));
  const shared = [...A].filter((w) => B.has(w)).length;
  return shared / (A.size + B.size - shared || 1);
}

/** What /imagine remembers per world: prompts that became designs, how often each is asked for, and today's usage. */
interface ImagineMemory {
  designs: Record<string, string>;
  asked: Record<string, { n: number; prompt: string }>;
  day: string;
  used: Record<string, number>;
  usedWorld: number;
  predesigned: number;
}

/** The "imagine:memory" service: /summon of a prompt someone already imagined uses that design. */
export interface ImagineMemoryService { lookup(text: string): string | undefined }

/**
 * /imagine <description>: Claude designs it and the player watches it arrive.
 *
 *   remembered   the same words again (in this world) → that design, at once
 *   stand-in     otherwise the bestiary's take is summoned right away (as /summon would)...
 *   draft        ...while a fast model designs it; the stand-in morphs into the draft where it stands
 *   polish       a stronger model improves the draft in the background; it morphs again
 *   remix        a close earlier prompt hands its design to the drafter to edit rather than start over
 *   pre-design   prompts asked for often get designed ahead of time, a few a day
 *
 * Each /imagine costs a tier-1 cast's aether (refunded if it fails); players and the world have daily caps.
 */
export function imagineModule(designer: ClaudeDesigner | null, env: NodeJS.ProcessEnv = process.env): ServerModule {
  const perPlayer = Number(env.IMAGINE_DAILY ?? 10), perWorld = Number(env.IMAGINE_WORLD_DAILY ?? 200);
  const predesignDaily = Number(env.IMAGINE_PREDESIGN_DAILY ?? 5), popularAt = 3;
  return {
    id: "imagine", name: "Imagine", version: "1.1.0", author: "LFG2",
    description: "Claude designs what players describe (/imagine), when the server has an Anthropic API key",
    setup(api) {
      const mem: ImagineMemory = { designs: {}, asked: {}, day: "", used: {}, usedWorld: 0, predesigned: 0, ...api.storage.load<ImagineMemory>("imagine") };
      const persist = () => api.storage.save("imagine", mem);
      const today = () => { const d = new Date().toISOString().slice(0, 10); if (mem.day !== d) { mem.day = d; mem.used = {}; mem.usedWorld = 0; mem.predesigned = 0; } };
      const summonsOf = () => api.use<SummonService>("summons");
      const remembered = (key: string) => { const id = mem.designs[key]; return id && summonsOf()?.designs.get(id) ? id : undefined; };
      api.provide("imagine:memory", { lookup: (text) => remembered(promptKey(text)) } satisfies ImagineMemoryService);
      api.provide("imagine:status", { enabled: !!designer });
      const closest = (key: string) => {
        let best: { key: string; id: string; score: number } | null = null;
        for (const [k, id] of Object.entries(mem.designs)) {
          const score = likeness(key, k);
          if (score >= 0.5 && (!best || score > best.score) && summonsOf()?.designs.get(id)) best = { key: k, id, score };
        }
        return best;
      };
      const busy = new Set<string>();
      let background = false;

      /** Morph the stand-in (or the last morph) into a saved design, or summon it fresh if it's gone. */
      const arrive = (name: string, id: string, ids: number[]): number[] => {
        const summons = summonsOf(), p = api.playerByName(name);
        const d = summons?.designs.get(id);
        if (!summons || !d) return ids;
        const prog = api.use<ProgressionService>("progression");
        if (p && prog && d.tier > tierForLevel(prog.level(p), api.std)) {
          api.tell(p, `✎ "${d.spec.name}" came out tier ${d.tier}: at level ${levelForTier(d.tier, api.std)} you can /summon design:${id} (or /ritual it)`);
          return ids;
        }
        // The design says how many (the stand-in's planner may have read "three tails" as three foxes).
        const all = ids.filter((i) => summons.state(i));
        const live = all.slice(0, Math.max(1, d.spec.count ?? 1));
        for (const extra of all.slice(live.length)) summons.remove(extra);
        if (live.length) {
          const r = summons.morph(live, d.spec);
          if (typeof r !== "string") return r;
          if (p) api.tell(p, `✎ It couldn't change shape (${r})`);
          return ids;
        }
        // The stand-in is gone (or there never was one): summon it; the ids arrive when it lands.
        const caster = api.use<Caster>("caster:summons");
        const out: number[] = [];
        if (caster && p) api.tell(p, caster.cast(p, `design:${id}`, { onSpawned: (n) => out.push(...n) }));
        return out;
      };

      const polish = (author: string, prompt: string, draft: { id: string; input: unknown }, ids: number[], key: string) => {
        if (!designer?.opts.polish) return;
        const summons = summonsOf();
        if (!summons) return;
        designer.polish({ prompt, author, std: api.std, summons, id: draft.id, from: { input: draft.input, note: "The first draft (already in the world, its render follows when you render it). Improve it:" } })
          .then((r) => {
            const p = api.playerByName(author);
            if (!r.ok) { api.log(`imagine polish failed: ${r.error}`); if (p) api.tell(p, "✎ The polish didn't pass the checks; keeping the draft"); return; }
            if (p) api.tell(p, `✎ "${r.name}" is finished (${r.seconds}s more)`);
            arrive(author, r.id, ids);
            mem.designs[key] = r.id; persist();
          })
          .catch((e) => api.log(`imagine polish failed: ${e instanceof Error ? e.message : String(e)}`));
      };

      // Pre-design what people keep asking for (one at a time, a few a day, when nobody's waiting on Claude).
      api.every(60, () => {
        if (!designer || background || busy.size) return;
        today();
        if (mem.predesigned >= predesignDaily || mem.usedWorld >= perWorld) return;
        const next = Object.entries(mem.asked).filter(([k, a]) => a.n >= popularAt && !remembered(k)).sort((x, y) => y[1].n - x[1].n)[0];
        const summons = summonsOf();
        if (!next || !summons) return;
        background = true;
        mem.predesigned++; mem.usedWorld++; persist();
        designer.draft({ prompt: next[1].prompt, author: "Claude", std: api.std, summons })
          .then((r) => { if (r.ok) { mem.designs[next[0]] = r.id; persist(); api.log(`imagine: pre-designed "${next[1].prompt}" as ${r.id}`); } })
          .catch((e) => api.log(`imagine pre-design failed: ${e instanceof Error ? e.message : String(e)}`))
          .finally(() => { background = false; });
      });

      api.command({
        name: "imagine",
        usage: "/imagine <a detailed description>",
        help: "Claude designs exactly what you describe, saves it to this world and summons it",
        admin: false,
        run(p, args) {
          if (!p) return "Only players can imagine things";
          if (!designer) return "Imagining needs the server to have an Anthropic API key (ANTHROPIC_API_KEY). /summon still works.";
          const prompt = args.join(" ").trim();
          if (prompt.length < 3) return "Describe what to make, e.g. /imagine an ancient obsidian salamander with glowing magma cracks";
          if (prompt.length > 1000) return "That's too long: keep it under 1000 characters";
          const summons = summonsOf();
          const caster = api.use<Caster>("caster:summons");
          if (!summons || !caster) return "Summons are switched off in this world";
          const key = promptKey(prompt);
          const asked = (mem.asked[key] ??= { n: 0, prompt });
          asked.n++;
          // Asked before: it's already designed.
          const known = remembered(key);
          if (known) { persist(); return `✎ Imagined before: ${caster.cast(p, `design:${known}`, {})}`; }
          const who = p.name.toLowerCase();
          if (busy.has(who)) return "Claude is still working on your last one";
          today();
          if ((mem.used[who] ?? 0) >= perPlayer) return `You've imagined ${perPlayer} things today; /summon still works, and tomorrow you can imagine more`;
          if (mem.usedWorld >= perWorld) return "This world has imagined all it can today; /summon still works";
          const prog = api.use<ProgressionService>("progression");
          const refund = prog ? prog.pay([p], 1) : () => {};
          if (typeof refund === "string") return `Can't imagine yet: ${refund}`;
          mem.used[who] = (mem.used[who] ?? 0) + 1; mem.usedWorld++;
          api.use<{ mark(p: unknown, id: string): void }>("firststeps")?.mark(p, "imagine");
          persist();
          busy.add(who);
          // The stand-in: the bestiary's take, summoned now (it pays its own cast, as /summon does).
          const ids: number[] = [];
          const stand = summons.plan(prompt).spec ? caster.cast(p, prompt, { onSpawned: (n) => ids.push(...n) }) : null;
          const near = closest(key);
          const from = near ? { input: { ...summons.designs.get(near.id)!.input, id: undefined }, note: `Someone imagined something close before ("${mem.asked[near.key]?.prompt ?? near.key}"). Its design follows: render it, then edit it into what this player asked for (give it its own name and id).` } : undefined;
          const started = Date.now();
          let last = 0;
          designer.draft({
            prompt, author: p.name, std: api.std, summons, from,
            onProgress: (note) => { const q = api.playerByName(p.name); if (q && Date.now() - last > 4000) { last = Date.now(); api.tell(q, `✎ ${note}`); } },
          }).then((r) => {
            const q = api.playerByName(p.name);
            if (!r.ok) { refund(1); if (q) api.tell(q, `✎ Couldn't imagine that: ${r.error}`); return; }
            if (q) api.tell(q, `✎ "${r.name}" (${Math.round((Date.now() - started) / 1000)}s): /summon design:${r.id}${designer.opts.polish ? " · polishing it now" : ""}`);
            mem.designs[key] = r.id; persist();
            const now = arrive(p.name, r.id, ids);
            polish(p.name, prompt, { id: r.id, input: r.input }, now, key);
          }).catch((e) => {
            refund(1);
            api.log(`imagine failed: ${e instanceof Error ? e.message : String(e)}`);
            const q = api.playerByName(p.name);
            if (q) api.tell(q, "✎ The designer couldn't be reached; try again in a moment");
          }).finally(() => busy.delete(who));
          return `✎ Claude is imagining "${prompt.slice(0, 80)}${prompt.length > 80 ? "…" : ""}"${near ? ` (from "${near.key}")` : ""}${stand ? `; meanwhile: ${stand}` : ""}`;
        },
      });
    },
  };
}
