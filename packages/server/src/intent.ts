import { arcFromReading, happeningFromReading, specFromReading, vehicleFromReading, type ArcDef, type HappeningDef, type Intent, type RacePlan, type SummonSpec } from "@lfg/shared";
import type { Interpreter } from "./interpreter";
import type { ServerModule } from "./kernel";
import type { Player } from "./player";
import type { Caster, CastContext } from "./modules/vanilla/progression";
import type { RaceService } from "./modules/vanilla/races";
import type { SummonService } from "./modules/vanilla/summons";

/**
 * The model reads, the game acts. Commands hand player requests here (/summon, /event, /race,
 * /hunt, /happen, /arc, voice): the interpreter reads each into an Intent, and this sends it to
 * the module that makes that kind of thing, as a plan (no words left to guess at). Each module
 * still checks, prices and limits it as before.
 *
 * Without an interpreter, or when it can't answer, the request goes the old way (`fallback`).
 */
export interface IntentService {
  /** Read `text` (asked with `via`) and act on it; tells the player the outcome. */
  handle(p: Player, text: string, via: string, fallback: () => string, ctx?: CastContext): void;
  /** Read only (for estimates and tools). */
  read(text: string, via: string): Promise<Intent | null>;
  /** Act on an intent already read. */
  act(p: Player, intent: Intent, text: string, ctx?: CastContext): string;
}

export function intentModule(interpreter: Interpreter | null): ServerModule {
  return {
    id: "core:intent", name: "Intent", version: "0.1.0", author: "lfg",
    description: "Claude reads what players ask for; the game makes it.",
    setup(api) {
      if (!interpreter) return; // the keyword planners read requests
      const theme = () => api.world.store.meta.theme?.title;
      const use = <T>(name: string) => api.use<T>(name);

      const act = (p: Player, intent: Intent, text: string, ctx: CastContext = {}): string => {
        const summons = use<SummonService>("summons");
        switch (intent.kind) {
          case "creature": {
            if (!intent.creature || !summons) break;
            const r = specFromReading(text, intent.creature, api.std, intent.count);
            return r.spec ? summons.castSpec(p, r.spec, r.notes, ctx) : `Couldn't make that: ${r.notes.join("; ")}`;
          }
          case "vehicle":
            if (!intent.vehicle || !summons) break;
            return summons.castSpec(p, vehicleFromReading(text, intent.vehicle, api.std), [], ctx);
          case "race": {
            const races = use<RaceService>("races");
            if (!intent.race || !races) break;
            const plan: RacePlan = { title: intent.race.title || intent.title || "Kart Race", laps: Math.max(1, Math.min(10, Math.round(intent.race.laps) || 3)), vehicle: intent.race.vehicle, notes: [] };
            return races.startPlan(p, plan);
          }
          case "hunt": {
            const hunts = use<{ startQuarry(p: Player, spec: SummonSpec | null, minutes: number, notes: string[], asked: string): string }>("hunts");
            if (!intent.hunt || !hunts) break;
            const q = specFromReading(text, intent.hunt.quarry, api.std);
            return hunts.startQuarry(p, q.spec ?? null, intent.hunt.minutes, q.notes, intent.hunt.quarry.name);
          }
          case "happening": {
            const h = use<{ startDef(p: Player, def: HappeningDef, minutes: number, notes: string[]): string }>("happenings");
            if (!intent.happening || !h) break;
            const r = happeningFromReading(intent.happening);
            return h.startDef(p, r.def, r.minutes, r.notes);
          }
          case "arc": {
            const arcs = use<{ startDef(p: Player, def: ArcDef, days: number): string }>("arcs");
            const r = intent.arc && arcFromReading(intent.arc);
            if (!r || !arcs) break;
            return arcs.startDef(p, r.def, r.days);
          }
          case "scenario": {
            const s = use<{ cast(p: Player, text: string, ctx: CastContext): string }>("scenarios");
            if (s) return s.cast(p, intent.request || text, ctx);
            break;
          }
          case "build":
          case "power": {
            const c = use<Caster>(`caster:${intent.kind}s`);
            const asked = intent.request || text;
            // Their planners still take words: restated plainly, they read them reliably.
            if (c?.plan(p, asked)) return c.cast(p, asked, ctx);
            break;
          }
          case "unclear":
            return intent.reply || "I'm not sure what you'd like. Try describing a creature, an event or a change to the world.";
        }
        return `I read that as a ${intent.kind}, but couldn't make it here.`;
      };

      const service: IntentService = {
        read: (text, via) => interpreter.read(text, { via, theme: theme() }),
        act,
        handle(p, text, via, fallback, ctx) {
          void interpreter.read(text, { via, theme: theme() }).then((intent) => {
            if (!api.players().includes(p)) return;
            const out = intent ? act(p, intent, text, ctx) : fallback();
            const said = intent && intent.kind !== "unclear" && intent.reply ? `${intent.reply}\n` : "";
            if (out) api.tell(p, `${said}${out}`);
          }).catch((e) => api.tell(p, `Something went wrong reading that: ${e instanceof Error ? e.message : e}`));
        },
      };
      api.provide("intent", service);
    },
  };
}
