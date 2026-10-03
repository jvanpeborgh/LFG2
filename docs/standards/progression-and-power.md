# Progression & summoning power

How a character's level relates to how big a thing they can summon. A level 1
player can summon a pig or a small cloud. A level 20 player can raise a city on
a mountainside or take on the powers of a wizard. Levelling is the way there,
and the cost of summoning is also what pays for the AI work behind it.

> Status: levels, XP, aether, shards, tiers with scale-down, rituals and the
> HUD are built (`packages/shared/src/progression.ts`,
> `packages/server/src/modules/vanilla/progression.ts`). Not built yet: epic
> builds and adoption (§5), self buffs (§6), and enforcing the token budgets
> (there's no agent yet to spend them). The material is a placeholder counter,
> "aether shards", from bosses and scenario wins. The numbers are in
> `defaults.json` under `progression` (tunable) and `locked.progression` (fixed).

Decisions this is based on:

| Question | Decision |
|---|---|
| Where XP comes from | Mixed, weighted to shared moments: a little from normal play, most from defending, beating bosses, and other people enjoying what you made |
| What gates summoning | **Aether** that refills over time for everything; tier 3 and up also costs a collected **material** (to be specified later) |
| Curve | Level 20 in about 30–50 hours of play; fast at first |
| What can change in-game | Numbers yes (rates, costs, durations, within the usual 10× per change); structure locked (level cap, tiers, unlock levels) |
| Asking above your tier | Scaled down to what your tier allows, with a note saying which level it needs; **or cast together as a ritual** |
| Epic builds | Temporary (a few real days) unless players adopt them |
| Powers on yourself | Timed buffs, longer and stronger at higher tiers |
| Scope | Levels are per world; a new world starts everyone at level 1 |

Similar systems in other games: D&D spell levels (big spells unlock late and are
rare even then) and its challenge ratings (how hard something is, compared with
the party's level); Minecraft enchanting (XP levels plus a material); WoW meeting
stones (others have to join to make it happen); MMO XP curves (fast early
levels, then about 10% more per level).

---

## 1. Power score and tiers

Every summon spec, scenario spec and module gets a **power score**, computed
during gathering from what it would actually do, not from what it's called.
Calling a kraken "a fish" doesn't make it cheap.

| Factor | Measured from |
|---|---|
| Size | longest side, volume of the model |
| Numbers | count, waves, enemies on the field at once |
| Danger | damage × health × speed, from the playtest metrics |
| Reach | area it changes (blocks placed or removed), how far it travels |
| Persistence | how long it lasts; whether it changes rules or adds code |
| Effect on players | buffs, crowd control, how many players it touches |

The score maps to a **tier**. Your level decides the highest tier you can cast.

| Tier | Unlocks at | Examples | Limits (on top of the 🔒 safety rules) |
|---|---|---|---|
| 1 Minor | level 1 | a pig, a parrot, a small cloud, a lantern | creatures ≤ 2 blocks; harmless or light hits; ≤ 3 at once |
| 2 Notable | level 4 | a wolf pack, a storm cloud, a flying shark, a pirate ship, a small hut | ≤ 6 blocks; hostile allowed; ≤ 16 × 16 area |
| 3 Major | level 8 | a kraken, a red dragon, a 3-wave pirate raid, a small tower, flight for 3 minutes | ≤ 16 blocks (boss rules apply); scenarios ≤ 3 waves; ≤ 32 × 32 area |
| 4 Epic | level 12 | a 5-wave raid with bosses, a village with villagers, a wizard's spell book | ≤ 48 × 48 area; one per player per real day |
| 5 Legendary | level 17 | a city with a civilization on a mountainside, a dragon war, the avatar of a storm | ≤ 128 × 128 area; **one at a time per world**, with a 2-hour world cooldown |

Tier 4 and 5 arrive as *epic* world events (long build-up, spaced out by the
director). Locked limits (hazards at once, damage caps, comfort rules, asset
budgets) apply at every tier. A higher level never lets anything get past
those.

## 2. Asking above your tier

**On your own:** the request is scaled down to the biggest version your tier
allows, with a note (the same way `fitSpecToRules` already notes what it
changed). For example, a level 1 player asking for "a huge kraken" gets:

> *A young kraken (2 blocks, harmless) arrives. A huge kraken needs level 8,
> or a ritual.*

Something fun always happens, and the goal is visible.

**Together, as a ritual** (like a WoW meeting stone):

1. The caster starts it: a circle in the magic colour appears around them, and a
   prompt is shown to everyone nearby: *"Alice is summoning a Huge Kraken. Join
   the ritual (1/3)."*
2. Other players join by standing in the circle within 60 s and confirming.
3. **Effective level** = the highest participant's level + 2 per extra
   participant, up to **one tier above** what the highest participant could
   cast alone. Tier 5 always needs either a level 17 caster or a ritual with one.
4. The cost (aether + material) is split among the participants. XP from the
   result is shared, and helpers get a bonus for joining.
5. If too few join before the circle fades, everyone gets their aether back and
   the caster gets the scaled-down version instead.

Rituals turn big summons into something people do together, and higher-level
players get a reason to help lower-level ones.

## 3. Aether, materials and AI tokens

**Aether** (the mana bar) is shown next to health and hunger.

| | Default |
|---|---|
| Maximum | 100 |
| Refills | 1 per minute online, 0.25 per minute offline |
| Cost by tier | 5 / 15 / 35 / 60 / 100 |
| Fizzles | 75% refunded (the checks still cost something, so spamming costs too) |
| Undone after arrival | no refund (the change happened, then broke) |

**Material** (placeholder name: *aether shards*; what it is and where it's
found will be specified later): tier 3 costs 1, tier 4 costs 3, tier 5 costs 8.
It should be found at the edges of the shared game (deep underground, from
bosses and scenario rewards, from creations that get adopted), so earning it is
part of the fun, not a separate grind.

**AI tokens.** Each tier has a token budget for the agent's work (planning,
generating code, checks, retries). The aether and material cost is what pays
for it, so the token budget follows the same gate:

| Tier | Agent token budget (initial guess, tune with real usage) |
|---|---|
| 1 | 20k |
| 2 | 60k |
| 3 | 150k |
| 4 | 400k |
| 5 | 1M |

A request that would go over its budget is scaled down or stops with a report,
like any other fizzle.

## 4. Levels and XP

Levels 1 to 20, per world. The XP to go from one level to the next:

| Level | 1→2 | 2→3 | 3→4 | 4→5 | 5→6 | then |
|---|---|---|---|---|---|---|
| XP | 100 | 200 | 300 | 400 | 720 | +10% each level (19→20 is ~2,730) |

Total to level 20 is about 23,900 XP. At a typical **10 XP per minute** of
engaged play, that's about 40 hours. Rough milestones: level 4 (tier 2) after
1–2 hours, level 8 (tier 3) after about 6 hours, level 12 (tier 4) after about
13 hours, level 17 (tier 5) after about 27 hours.

**Where XP comes from** (weighted to shared moments):

| Source | XP | Limits |
|---|---|---|
| Normal play (mining: 1 per block; defeating mobs: 1, or 3 for hostile ones) | about 3 per minute | at most 4 per minute from this source |
| Taking part in a scenario wave (near it, dealing or taking damage) | 40 per wave | — |
| Defeating a boss (split by contribution) | 150 | — |
| Winning a scenario | 100 | — |
| Joining a ritual | 30, plus a share of the result | — |
| Others enjoy your creation (distinct players who use it, fight it, visit it) | 10 per player | 300 per creation per day; not your ritual partners from that cast |
| Your build gets adopted (§5) | 500 | — |

Anti-farming: no XP from fighting your own summons; diminishing returns when
the same small group keeps rewarding each other; XP from a creation only counts
players who actually engaged with it (time spent, interactions), not just ones
who walked past.

**Dying** costs no XP. Respawns stay short, per the fun principles.

## 5. Epic builds: temporary unless adopted

Tier 4 and 5 builds (a village, a city) take over part of the shared world, so
by default they're temporary:

- They last **3 real days**, inside a claimed region sized by tier. They can
  only be placed on unclaimed land, never over other players' builds. Their
  NPCs and behaviours run within the usual module budgets.
- Players can **adopt** one: when at least 5 distinct other players (or 30% of
  the world's active players, whichever is smaller) use it, visit it, or vote
  "keep", it becomes permanent and its creator gets the adoption XP.
- Not adopted: it fades out as a world event ("the city sinks back into the
  mountain"), and the land returns to what it was before.

## 6. Powers on yourself ("the power of a wizard")

Summons can change the summoner, as **timed buffs**:

| Tier | Example | Lasts |
|---|---|---|
| 2 | night vision, +20% speed, water breathing | 5 min |
| 3 | flight, a fire bolt spell | 3 min |
| 4 | a wizard's spell book: 3–4 spells with cooldowns | 10 min |
| 5 | an avatar form (storm giant, archmage) | 10 min, once per real day |

Buffs follow the balance rules: at most 20% stronger than the best existing
thing at that tier; invulnerability ≤ 3 s; crowd control ≤ 1.5 s. They're
visible to everyone (an aura in the magic colour). They're weaker in PvP areas
so they can't decide fights on their own.

## 7. What can change in-game

| Tunable through `/rule` (🌍, within 10× per change) | Locked (🔒) |
|---|---|
| XP rates for each source, XP per level (scaled) | Level cap (20) and the number of tiers (5) |
| Aether maximum, refill speed, cost per tier | The level that unlocks each tier |
| Material cost per tier | Tier 5: one at a time per world |
| Buff durations, epic build lifetime, adoption threshold | Ritual reach: at most one tier above the highest participant |
| Ritual join window | All existing safety limits |

That way a world can be faster or slower, more generous or stingier, but
"level 1 summons a city" can't happen by tweaking numbers.

## 8. Voice

Everything here can be cast by voice: hold **B** (or the 🎤 button), say
"summon a huge kraken" or "start a ritual to summon a red dragon", release.
What was heard and the command it becomes are shown for 2 seconds before
sending (Enter sends now, Esc cancels); chat lines and unsure transcripts wait
for Enter. Players say "join the ritual" (or press **J**) to help. See the
README for how transcription is set up.

## 9. Still open

- What the material is, where it's found and how it's shown (to be specified).
- How the power score is weighted exactly: tune it on real requests with the
  shadow playtest metrics, and check that each tier feels about as strong as
  its examples.
- The token budgets per tier: measure real agent usage first.
