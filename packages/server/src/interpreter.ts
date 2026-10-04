/**
 * Claude reads what players ask for. Every request ("/summon a sleepy dragon I can ride", "/event
 * moon gravity for ten minutes", "make everyone tiny and fast", a voice command) is read once into
 * an Intent (shared intent.ts): what kind of thing it is and everything needed to make it, in the
 * game's own vocabulary (its body templates, features, palette, rules). The game then builds it
 * and checks it the same way as always: the model decides what was meant, never what's allowed.
 *
 * Without credentials (offline, tests) there's no interpreter, and the keyword planners read
 * requests as they did before.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import {
  ARCS, CREATURE_ABILITIES, DEFAULT_STANDARDS, ELEMENTS, FEATURE_KIT, HAPPENINGS, HAPPENING_EFFECTS, HAPPENING_RULES, INTENT_KINDS, LEGACY_FEATURES,
  MOODS, SKILLS, SURFACES, TEMPLATES, type Intent, type Standards,
} from "@lfg/shared";

const GAITS = ["walk", "crawl", "slither", "hop", "waddle", "flutter", "glide", "float", "stride"] as const;
const VEHICLE_KINDS = ["kart", "car", "truck", "buggy", "bike"] as const;

/** What the interpreter needs from the server (an interface so tests can stand in for Claude). */
export interface Interpreter {
  /** Read a request; null when it can't be read now (no answer in time, an API error): fall back. */
  read(text: string, ctx?: ReadContext): Promise<Intent | null>;
}
export interface ReadContext {
  /** Where it was asked: /summon, /event, voice… (the same words can mean different things). */
  via?: string;
  /** The world's theme, if it has one ("a cyberpunk samurai city"). */
  theme?: string;
}

function schemaFor(std: Standards) {
  const palette = Object.keys(std.art.palette) as [string, ...string[]];
  const colours = z.object({ main: z.enum(palette), belly: z.enum(palette), accent: z.enum(palette) });
  const creature = z.object({
    name: z.string().describe("What it's called, 1-4 words, title case"),
    skill: z.enum(SKILLS.map((s) => s.id) as [string, ...string[]]),
    template: z.enum(Object.keys(TEMPLATES) as [string, ...string[]]).nullable().describe("The body template closest to it, or null for the skill's own"),
    mood: z.enum(MOODS as [string, ...string[]]),
    style: z.enum(["voxel", "smooth", "lowpoly", "sculpted"]).nullable().describe("Only if the player asked for a drawing style"),
    movement: z.enum(["walk", "fly", "swim", "hover", "drift", "sail"]),
    temperament: z.enum(["passive", "neutral", "hostile"]),
    length: z.number().describe("Longest side in blocks (a player is 1.8 tall; a horse ~2.4; a dragon 5-12)"),
    colors: colours,
    features: z.array(z.enum([...FEATURE_KIT, ...LEGACY_FEATURES] as [string, ...string[]])),
    finish: z.enum(["gloss", "metal", "glow"]).nullable(),
    gait: z.enum(GAITS),
    surface: z.enum(SURFACES as [string, ...string[]]).nullable(),
    abilities: z.array(z.enum(CREATURE_ABILITIES as [string, ...string[]])),
    element: z.enum(ELEMENTS as [string, ...string[]]).nullable(),
    ride: z.boolean().describe("Made to be ridden"),
  });
  return z.object({
    kind: z.enum(INTENT_KINDS),
    title: z.string(),
    reply: z.string(),
    creature: creature.nullable(),
    count: z.number().int(),
    vehicle: z.object({ kind: z.enum(VEHICLE_KINDS), name: z.string(), colors: colours.nullable(), size: z.number() }).nullable(),
    race: z.object({ title: z.string(), laps: z.number().int(), vehicle: z.enum(VEHICLE_KINDS) }).nullable(),
    hunt: z.object({ quarry: creature, minutes: z.number().int() }).nullable(),
    happening: z.object({
      title: z.string(), description: z.string(), minutes: z.number().int(),
      rules: z.array(z.object({ path: z.enum(HAPPENING_RULES.map((r) => r.path) as [string, ...string[]]), factor: z.number() })),
      effect: z.enum(HAPPENING_EFFECTS as [string, ...string[]]).nullable(),
    }).nullable(),
    arc: z.object({ arc: z.enum(ARCS.map((a) => a.id) as [string, ...string[]]), days: z.number().int() }).nullable(),
    request: z.string().nullable(),
  });
}

function instructions(): string {
  const skills = SKILLS.map((s) => `- ${s.id}: ${s.description}`).join("\n");
  const rules = HAPPENING_RULES.map((r) => `- ${r.path}: ${r.what} (factor ${r.min}–${r.max})`).join("\n");
  const examples = HAPPENINGS.map((h) => `- ${h.title}: ${h.description}${h.rules.length ? ` [${h.rules.map(([p, v]) => `${p} ${v}`).join(", ")}]` : ""}${h.effect ? ` (effect ${h.effect})` : ""}`).join("\n");
  const arcs = ARCS.map((a) => `- ${a.id}: ${a.title}, ${a.description} (${a.days} days by default)`).join("\n");
  return `You read what players ask for in LFG2, a shared voxel world where players make things happen by describing them. Read each request into one intent: decide what kind of thing it is and fill in that kind's fields from the game's vocabulary. Set every other kind's field to null.

Kinds:
- creature: something living (or animate) to bring into the world: animals, monsters, people, spirits, golems, plants that walk. Fill "creature" and "count" (how many, 1 unless they asked for more; at most 8).
- vehicle: something to drive (kart, car, truck, buggy, motorbike). Fill "vehicle".
- race: a race or course to race on ("a mario kart course", "a buggy rally, 5 laps"). Fill "race" (laps 1-10, default 3; vehicle default kart).
- hunt: a creature to track down and defeat, let loose far away ("hunt a frost wyrm"). Fill "hunt": the quarry as a creature (hostile, a worthy boss) and minutes (default 15, at most 30).
- happening: the world's rules changed for a while, for everyone ("low gravity", "everyone is tiny and fast", "the floor is lava", "a peaceful day"). Fill "happening": rule factors from the list below (only those it changes) and/or one effect; minutes default 5, at most 15. You can combine rules to make up new happenings.
- arc: a world event lasting days. Only these exist; fill "arc" (days 1-7).
- scenario: an invasion or raid in waves (pirates raid the coast, an army of skeletons attacks). Fill "request" with the request restated plainly.
- build: a structure built for them (a village, a castle, a lighthouse, a city). Fill "request".
- power: a power for the player themselves (become a wizard, wings, super speed, see in the dark, breathe underwater, fire bolts, become a giant/avatar). Fill "request".
- unclear: you can't tell what they want, it isn't something the game can make, or it's harmful. Say why, briefly and kindly, in "reply", with a suggestion.

For every kind, "title" is a short banner name and "reply" one short friendly line to the player.

Creatures: pick the archetype skill and, where one fits, the body template closest to its shape (a kraken is "tentacled", a griffin "winged-creature" with the "raptor" template; an unknown animal takes the nearest real one). Choose features the player named or that make it read as what they asked for, from the kit only. Colours are palette keys: hue then shade, 1 darkest to 5 lightest; neutral1 is near black and neutral8 near white. Temperament: hostile only if it's meant to attack (angry, evil, a monster); pets, mounts and most animals are passive or neutral. Hostile creatures need abilities (bite, breath, shot, charge, stomp; breath and shot need an element). Size: honour the words (tiny, huge), within reason. "ride": true when they want to ride it. Name it as the player would ("Sleepy Dragon", "Frost Wyrm").

Archetype skills:
${skills}

Happening rules (factors multiply the normal value; 1 = unchanged):
${rules}
Effects: peace (nobody is hurt), night (night holds), day (day holds), lava (natural ground burns).
Examples of happenings:
${examples}

Arcs:
${arcs}

Read the whole request: "a fast horse" is a creature, not a happening; "a race with dragons" is a race; "make me fly" is a power; "a dragon to ride" is a creature with ride true. A request may come by voice, transcribed with mistakes: read what they most likely meant.`;
}

/** Claude as the reader. One call per request (cached), structured to the schema. */
export class ClaudeInterpreter implements Interpreter {
  private client = new Anthropic();
  private cache = new Map<string, Intent>();
  private schema: ReturnType<typeof schemaFor>;
  private system: string;
  constructor(readonly opts: { model: string; effort: "low" | "medium" | "high"; timeoutMs: number; std?: Standards; log?: (msg: string) => void }) {
    this.schema = schemaFor(opts.std ?? DEFAULT_STANDARDS);
    this.system = instructions();
  }

  /** An interpreter when the environment has Anthropic credentials, else null (keyword reading stays). */
  static fromEnv(env: NodeJS.ProcessEnv, std?: Standards): ClaudeInterpreter | null {
    if (env.INTERPRETER === "off" || (!env.ANTHROPIC_API_KEY && !env.ANTHROPIC_AUTH_TOKEN)) return null;
    const effort = (["low", "medium", "high"] as const).find((e) => e === env.INTERPRETER_EFFORT) ?? "low";
    return new ClaudeInterpreter({ model: env.INTERPRETER_MODEL || "claude-opus-5-5", effort, timeoutMs: Number(env.INTERPRETER_TIMEOUT_MS ?? 25000), std, log: env.INTERPRETER_DEBUG ? (m) => console.log(`[interpreter] ${m}`) : undefined });
  }

  async read(text: string, ctx: ReadContext = {}): Promise<Intent | null> {
    const key = `${ctx.via ?? ""}|${ctx.theme ?? ""}|${text.trim().toLowerCase().replace(/\s+/g, " ")}`;
    const hit = this.cache.get(key);
    if (hit) return structuredClone(hit);
    const t0 = Date.now();
    try {
      const response = await this.client.beta.messages.parse({
        model: this.opts.model,
        max_tokens: 4000,
        output_config: { effort: this.opts.effort, format: betaZodOutputFormat(this.schema) },
        // If the model declines, the request re-runs on its recommended fallback model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        // The instructions are the same for every request: cached.
        system: [{ type: "text", text: this.system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: `${ctx.via ? `Asked with ${ctx.via}. ` : ""}${ctx.theme ? `This world's theme: ${ctx.theme}. ` : ""}The request:\n${text.slice(0, 600)}` }],
      }, { timeout: this.opts.timeoutMs, maxRetries: 1 });
      if (response.stop_reason === "refusal") { this.opts.log?.(`refused "${text}"`); return null; }
      const intent = response.parsed_output as Intent | null;
      this.opts.log?.(`"${text}" → ${intent?.kind} ${intent?.title ?? ""} (${Date.now() - t0} ms, cache read ${response.usage.cache_read_input_tokens ?? 0})`);
      if (!intent) return null;
      if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, intent);
      return structuredClone(intent);
    } catch (e) {
      this.opts.log?.(`"${text}" failed after ${Date.now() - t0} ms: ${e instanceof Error ? e.message : e}`);
      return null;
    }
  }
}
