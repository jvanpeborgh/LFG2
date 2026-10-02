# Game design, balance & keeping it fun

## 1. Fun principles

Every agent should keep these in mind. The automatic "fun report" checks them.

1. **Player control comes first.** Never take control away from a player for
   more than 3 s 🔒. Knockbacks, stuns and cutscenes stay short.
2. **Telegraph, then punish.** Anything that hurts gives at least 0.75 s of
   warning (visual + sound). No unavoidable deaths.
3. **Something to do within 10 seconds.** A new player, or someone who just
   respawned, should find something interesting nearby straight away.
4. **Clear cause and effect.** If something happens to you, you should be able
   to tell why, and which world event caused it (the kernel's inspector helps).
5. **Every power has counterplay.** A dodge, a block, a counter-item, a hiding
   place, or a cooldown window.
6. **Your fun can't cost everyone else theirs.** Changes affect everybody, so
   design for the whole world, not just yourself. (See griefing, §7.)
7. **Build on what's there.** Prefer extending other players' creations
   (with their modules' APIs) over replacing them. Remix is more fun than
   reset.
8. **Leave room to breathe.** Not every event needs to be bigger than the last
   one. Calm moments make the big ones feel big.

## 2. Pacing: the director

A built-in `director` module (inspired by the "AI Director" in Left 4 Dead)
keeps the world from becoming non-stop chaos or boring.

- It tracks a world **intensity** level from 0 (calm) to 3 (peak), based on
  combat, damage taken, active hazards, deaths, and recent events.
- It runs a **tension → peak → relief** cycle (default about 6–10 minutes).
- The **event queue asks the director** before an event arrives:
  - at high intensity, big hostile events wait and calmer ones go first;
  - after a peak, there's a relief window (default 60–90 s) with no new hazards;
  - if things are too quiet for too long, it invites agents' queued events
    forward.
- Modules can read the intensity to scale themselves (fewer mobs when it's
  already hectic).
- **Chaos budget:** at most 3 active world-wide hazards at once 🔒; extra ones
  have to be local or wait.

## 3. Baseline numbers

These are the defaults (also in `defaults.json`). Agents change them through
world events, or locally inside their own mode/area.

### Player

| Stat | Default |
|---|---|
| Health | 100 |
| Walk / sprint speed | 4.3 / 5.6 m/s |
| Jump height | 1.25 blocks |
| Gravity | 32 m/s² (snappy, game-like) |
| Fall damage | starts after 4 blocks |
| Respawn time | ≤ 5 s 🔒 (max 10 s in a game mode) |
| Spawn protection | 5 s |
| Health regen | after 6 s without damage, 5 HP/s |

### Combat

| Rule | Default |
|---|---|
| Light / heavy hit | 12 / 25 damage |
| Max damage from one hit | 40 % of max health, unless telegraphed ≥ 1.5 s (boss attacks) |
| Time to defeat a player (PvP) | 2–4 s of sustained, landed hits |
| Normal enemy | 3–6 hits to defeat |
| Boss fight | 2–5 minutes with 10+ players; scales with the number of players nearby |
| Ability cooldowns | ≥ 1 s; strong abilities ≥ 10 s |
| Crowd control (stun/root) | ≤ 1.5 s, with ≥ 3 s immunity afterwards |

### Power creep limits

- New items/abilities should be **at most 20 % stronger** than the best existing
  thing in the same tier. Bigger jumps need a new tier with a real cost to reach.
- "Strongest" is measured by the shared balance tool (damage per second,
  effective health, mobility), which the checks run automatically.
- Anything that makes a player **invulnerable, or kills instantly**, must be
  short (≤ 3 s), visible to everyone, and have a long cooldown.

## 4. Economy & resources

- **No free infinite resources.** Everything that creates items or currency
  needs a cost, a cooldown or a limit.
- Track the totals: the economy module watches how much of each resource exists
  and warns agents about inflation (e.g. currency growing > 10 % per hour).
- **Sinks for every source.** If you add a way to earn something, add a way to
  spend or lose it.
- Rare things should stay rare: drop rates for "legendary" ≤ 1 %.
- Session worlds reset; persistent worlds need extra care before adding any
  economy.

## 5. Game modes & scenarios

A mini-game or scenario (e.g. "the floor is lava", "capture the chicken")
should declare:

- **Area** (or "whole world"), **who's in** (opt-in zone, team sign-up, or
  everyone), **win/lose conditions**, **length** (default rounds of 3–10 min),
  **scoring**, and what happens **when it ends** (rewards, clean-up).
- **Clean up after yourself:** blocks, entities and rule changes made by a
  mode are removed or restored when it ends, unless it says otherwise.
- **Late joiners** can get in quickly or watch.
- **Losing is still fun:** short respawns, spectating, comeback mechanics
  (losing team gets a small boost).

## 6. World events (from the player's point of view)

Since every change arrives as a world event (see `ARCHITECTURE.md` §5):

- **Name and announce it**: banner + stinger + who made it ("⚡ Lava Rain — by
  Alice").
- **Build-up you can react to**: players should be able to tell what's coming
  and where (gathering effects at the location; a direction marker if it's off
  screen).
- **Size categories**: *minor* (cosmetic, a new creature, a tweak),
  *major* (new mechanic, new mode, hazard), *epic* (engine change, standards
  change). Bigger = longer build-up and longer cooldown before the next epic.
- **Ending**: temporary events say how long they last; permanent changes say
  so.

## 7. Griefing & respecting other players

- **Spawn and safe zones** are protected; hostile effects can't reach them.
- **Other players' builds** are protected by default. Modules can only change
  them in opt-in areas (an arena, a "destructible" zone) or with the builder's
  permission.
- **PvP is opt-in** by area or game mode, not everywhere.
- **No targeting individuals.** Modules can't single out a specific player for
  punishment (e.g. "Bob takes double damage") unless it's part of fair game
  rules (e.g. the player in the lead, chosen by the rules).
- No trapping players with no way out (kernel check: every player can always
  reach open air / respawn).

## 8. The automatic fun report

During the "gathering" checks, test bots play the change on the shadow copy of
the world and measure:

| Metric | Healthy range (default) |
|---|---|
| Deaths per player per minute | ≤ 1 (outside opt-in combat modes) |
| Time without control | ≤ 3 s at a time 🔒 |
| Players stuck / trapped | 0 🔒 |
| Hits a newcomer takes before seeing a warning | 0 |
| Change in the world intensity level | within the director's current budget |
| Balance tool: power vs current best | ≤ +20 % per tier |

Hard (🔒) failures make the event fizzle. Everything else goes into a short
report for the agent ("bots died 4× per minute in the arena; consider a longer
warning on the lava eruption") so the agent can improve it, but the event can
still go ahead.
