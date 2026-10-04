# Imagining more than creatures

Players can already imagine creatures (`/summon`, `/imagine`), ride them (mounts), drive what
they imagine (vehicles), raise buildings (`/build`), take on powers, change the weather and
stage invasions from the sea. This doc is about the next step: **imagining things that happen**:
- a race on a course someone dreamed up;
- a storm that lasts a weekend;
- an afternoon where gravity is low;
- a game mode borrowed from another game.

It covers what players could ask for, one framework that runs all of it, how to keep it fair and
safe, and the order to build it in.

## What players could ask for

Grouped by what the game has to do, with the game each idea comes from.

### Races and sports
| Ask | From | Built from |
| --- | --- | --- |
| "a Mario Kart course with karts for everyone" | Mario Kart | track, checkpoints, laps, karts, item boxes, boost pads |
| "a dragon air race through rings over the mountains" | Pilotwings, Spyro | ring gates in the air, flying mounts |
| "a horse derby round the lake" | Red Dead | track, ground mounts |
| "a boat regatta between the islands" | Wave Race | buoys as checkpoints, sail mounts |
| "a parkour race up the cliff" | Mario, Minecraft parkour | built course, checkpoints, respawn at the last one |
| "car football with a giant ball" | Rocket League | arena, physics ball, goals, teams, score |
| "mini golf" | Golf With Your Friends | holes, a ball you hit, strokes |

### Fights and survival
| Ask | From | Built from |
| --- | --- | --- |
| "pirates invade the coast in waves" (exists) | Tower defence, horde modes | waves, bosses, reward chest |
| "hunt a giant beast in the forest" | Monster Hunter | a boss with a roaming area, tracks to follow, parts to break |
| "zombies attack every night for a week" | Terraria blood moon, 7 Days to Die | a long event with nightly stages |
| "king of the hill" / "capture the flag" | shooters | zones, teams, score |
| "a shrinking storm, last one standing" | Fortnite | a moving border, survival, spectators |
| "a TNT arena" / "spleef" | Bomberman, Minecraft | built arena, rule tweaks (blocks break on touch) |
| "my summons battle yours" | Pokémon | arena, turn or real-time creature duels, betting |

### Exploration and mysteries
| Ask | From | Built from |
| --- | --- | --- |
| "a treasure hunt with riddles" | Sea of Thieves | clue chain, hidden chests, maps |
| "a dungeon under the ruins" | Zelda, Diablo | generated rooms, keys, a boss, loot |
| "a haunted mansion we have to escape" | escape rooms | built structure, puzzles (levers, plates), a timer |
| "an archaeology dig" | Animal Crossing fossils | buried finds, a collection to fill |

### Long world events
| Ask | From |
| --- | --- |
| "a meteor shower that leaves rare ore" | Terraria |
| "the volcano erupts for three days" | Don't Starve |
| "a festival with traders and games in the village" | Stardew Valley |
| "a blood moon" / "an eclipse" | Terraria |
| "the herds migrate across the plains" | Planet Zoo |
| "a dragon roosts on the mountain all week" | Skyrim (a persistent boss) |
| "winter comes": snow, frozen lakes, sleds | Stardew seasons |

### Rule and mechanic changes (temporary)
| Ask | From |
| --- | --- |
| "low gravity" (moon day) | Mario Galaxy |
| "the floor is lava" (lava rises slowly) | Roblox |
| "everyone is giant" / "everyone is tiny" | Alice, Minecraft scale mods |
| "ice world": everything slippery | Mario ice levels |
| "bouncy blocks", "speed boost paths" | Mario, Sonic |
| "peace day": no damage, no breaking blocks | social games |
| "one-hit duels" | duel games |
| "everyone glows at night" / "paint wars" (blocks you touch take your team colour) | Splatoon |
| "hide and seek: seekers glow, hiders turn into blocks" | Prop Hunt |

## One framework for all of it: events

The invasion director already does most of this, for one kind of event. Generalise it.

**An event spec is plain data**, like a summon spec, so an agent can write one:

```
EventSpec {
  kind: "race" | "invasion" | "hunt" | "arena" | "treasure" | "world" | "rules"
  title, prompt, by
  site:     where it happens (found by the planner: a coast, a flat meadow, a lake, a mountain)
  props:    structures it builds for itself (track, arena, gates), temporary like /build
  cast:     summons and vehicles it brings (karts for everyone, the beast, the traders)
  rules:    rule overrides while it runs (gravity 0.4, no block breaking, damage off)
  stages:   gather → start (countdown) → play (goals, timers, waves) → finish
  goals:    laps and checkpoints, score, survive, find, defeat; how a winner is decided
  join:     who takes part (everyone near, opt-in with /join, teams)
  rewards:  items and XP by placing, a trophy, the event's own loot
  limits:   duration, players, cost (aether), tier
}
```

**One director runs every kind.** It finds the site, builds the props, brings the cast, applies the
rules, runs the stages, shows the HUD, gives rewards, and then **undoes everything**: props come
down, rules revert, the cast leaves.

Undo already works for live rule changes and temporary builds. The event owns all of it, so a
crash or a reload still cleans up, because the state is saved.

**Pieces to build once and share:**
- **Trigger volumes:** boxes or rings that notice who passes (checkpoints, goals, zones, traps).
- **Event HUD:** a title, a timer, a score or placings table, and a lap or wave counter (the
  invasion HUD, generalised).
- **Teams and joining:** `/join`, team colours on name tags, spectators who can watch.
- **Pickups:** item boxes that hand out a random power-up (boost, shield, banana, shell); the powers
  system already does timed effects.
- **Rule overrides with a timer:** the live rule system, scoped to an event, with an automatic
  revert.
- **Props:** `/build` primitives with a "temporary, owned by event X" tag (it exists for
  builds).

## Fair, safe and fun

- **Consent:**
  - an event that changes the rules for everyone (low gravity, peace day) needs the world owner,
    or a vote of the players there;
  - an event only you join (a race) just needs space;
  - nobody is pulled into a fight they didn't join.
- **Space:** props are placed only where nothing anyone built stands. The site finder avoids
  claimed or built-up areas, so nothing is griefed. Props never replace blocks they can't put back.
- **Telegraph:** like summons, an event announces itself first ("A race course is being drawn
  by the lake… 10 s"), and can be cancelled.
- **Playtest before it arrives:** races get a simulated lap (can a kart get round? Is every
  checkpoint reachable?), the same as summons and invasions are playtested.
- **Cost:** aether by size and length, like summons; long world events need the world owner or a
  ritual.
- **Limits:**
  - one big event at a time per area;
  - world events capped in length;
  - everything an event creates is counted and removed.

## Mounts, vehicles and loot feed into events

- Races use **vehicles** (karts for everyone) and **mounts** (dragon air races).
- Hunts and invasions drop **creature loot**: armour, weapons and items made from what you
  defeated, with its colours, its element, lore naming it and its maker, and stats from its level
  and yours. Rewards then become memorable things, not just diamonds. (Planned next, see the
  roadmap.)

## Roadmap

1. **Kart race** (the first non-combat event, and the template for the rest):
   - **Course:** "a Mario Kart course" plans a closed loop on flat-ish ground nearby. The loop is
     a ring with wobble, sized to the player count. The road is laid as a strip of coloured
     blocks a few wide, with kerbs and lanterns along it.
   - **Race furniture:** checkpoints every few blocks (in order, so shortcuts don't count), a
     start and finish gate, a start grid, and a kart for each player who joins.
   - **Race flow:** a countdown, then laps. The HUD shows lap, position and time.
   - **Finish and cleanup:** placings and rewards at the end, then the track comes down.
   - **Boosts and items (done):** boost pads on the straights, and item boxes with a mushroom, a
     shell or a star, weighted towards whoever's behind.
2. **Rule events:** low gravity, giant or tiny, ice, peace day, floor is lava. Each runs on a timer
   with a banner and a guaranteed revert; world-wide ones need the owner or a vote.
3. **Creature loot:** gear with looks, lore and attributes from what you defeat (task #62).
4. **Hunts and arenas:**
   - a roaming boss with tracks to follow;
   - king of the hill and capture the flag on generated arenas;
   - summon battles.
5. **World events:**
   - multi-day arcs (blood moon week, meteor shower, festival) that persist across restarts;
   - the "dragon on the mountain" persistent boss.
6. **Agents write event specs:** the keyword planners become a fallback; the designer agent
   writes EventSpecs the way it writes creature designs. The director and playtest check them the
   same way.
