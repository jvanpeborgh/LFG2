# World Bible — shared standards for every agent

Every player's agent reads these standards before it writes anything. They give
30 different agents a common base, so the world feels like one game and stays
fun, instead of 30 clashing styles and broken balance.

They are a **starting point, not a cage**. Most of them can be changed, either
locally (inside one module or area) or for the whole world, through a world
event (see "Changing the standards" below).

| File | Covers |
|---|---|
| [art-and-3d-assets.md](art-and-3d-assets.md) | Default visual style, palette, scale, how to generate 3D models, animation, lighting, shaders, VFX |
| [audio-and-music.md](audio-and-music.md) | Default musical identity, adaptive music, sound effects, loudness, spatial audio, licensing |
| [game-design-and-fun.md](game-design-and-fun.md) | Fun principles, pacing (the "director"), balance numbers, economy, game modes, griefing, world-event design |
| [progression-and-power.md](progression-and-power.md) | Levels and XP, summoning tiers by level, aether and materials (and the AI token budget they pay for), rituals, epic builds, self buffs |
| [ux-accessibility-and-comfort.md](ux-accessibility-and-comfort.md) | HUD and UI rules, text, readability, accessibility, photosensitivity and motion comfort |
| [defaults.json](defaults.json) | The same numbers in machine-readable form; modules import these instead of hard-coding values |

---

## How agents use them

1. **Read first.** The agent's `read_standards` tool returns these docs plus the
   world's *current* values (which may have been changed by earlier events).
2. **Import, don't hard-code.** Modules use the shared values, e.g.

   ```ts
   import { STANDARDS } from "@world/standards";
   const dmg = STANDARDS.balance.damage.lightHit;     // not "12"
   const color = STANDARDS.art.palette.danger;          // not "#ff3b1f"
   ```

   So when the world's standards change, existing content follows along.
3. **Get checked.** The automatic checks in the "gathering" phase (see
   `ARCHITECTURE.md` §5–6) test every change against the standards.
   - **Hard rules** (marked 🔒) fail the change: it fizzles.
   - **Soft rules** (everything else) produce warnings and a "fun/style report"
     that goes back to the agent. The change can still arrive.

---

## Three tiers of rules

| Tier | Who can change it | Examples |
|---|---|---|
| 🔒 **Locked** (kernel) | Nobody in-game; only the platform developers | Performance budgets, photosensitivity limits, loudness ceilings, player can always move/open the menu, max time without control, content rating |
| 🌍 **World defaults** | Any agent, through a **major world event** | Art style, palette, music key/tempo, base player speed and health, damage scale, economy rates |
| 📍 **Local overrides** | The module's author, inside the module's own area or mode | A neon dungeon with its own palette, a low-gravity arena, a horror zone with its own music |

Local overrides must stay within the locked rules, and they end at the edge of
the area/mode that declares them.

## Changing the standards

Changing a world default is itself a **world event**, and a big one:

- the agent casts a `standards` change (e.g. "palette → neon", "gravity × 0.5");
- it goes through the same automatic checks, including re-checking existing
  modules against the new values;
- it arrives with a long build-up and a name ("⚡ The Neon Age begins"),
  and everything that imports the standards changes at once;
- at most one standards change every N minutes (default 10), so the world
  doesn't lose its identity every few seconds;
- it can be undone like any other event.
