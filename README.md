LFG2
====

A shared voxel world that runs in the browser. The base game covers Minecraft's
core survival and creative play, and it is built the way
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) describes: a small trusted
**kernel** that hosts **modules**, so player-directed AI agents can later add,
change or replace any part of the game while everyone keeps playing.

| | |
|---|---|
| ![Snowy forest at spawn](docs/screenshots/snowy-forest.jpg) | ![Creative inventory](docs/screenshots/inventory.jpg) |

![Flying over the coast](docs/screenshots/overview.jpg)

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): the overall design (kernel, modules, sandboxing, world events, crash prevention)
- [docs/standards/](docs/standards/README.md): the shared "world bible" (art style, audio, balance, fun, comfort) that the code reads its numbers from

## Run it

Needs Node 22+.

```sh
npm install
npm run build   # build the browser client
npm start       # game server + client on http://localhost:8080
```

Open http://localhost:8080 in two browser windows to play together. Anyone on
your network can join at `http://<your-ip>:8080`.

For development with hot reload:

```sh
npm run dev     # server on :8080 (restarts on change) + Vite on http://localhost:5173
```

Server settings (environment variables):

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 8080 | HTTP + WebSocket port |
| `WORLD` | `world` | World name (saved in `data/<WORLD>/`) |
| `SEED` | random | World seed (only used when creating a world) |
| `VIEW_DISTANCE` | 4 | Chunk radius streamed to each player (32 blocks per chunk) |
| `ADMINS` | *(everyone)* | Comma-separated names allowed to use admin commands. Empty = everyone is admin (fine for local play, not for a public server) |
| `DATA_DIR` | `./data` | Where worlds are saved |

Type commands into the server console too (e.g. `time set night`, `modules`).

## Checks

```sh
npm run typecheck   # TypeScript, all packages
npm test            # unit + server integration + gameplay tests (vitest)
npm run build && npm run e2e   # two players in headless Chromium, saves screenshots to test-results/
npm run e2e:rules              # two players; one changes rules and adds code, the other sees it live
npm run e2e:summons            # summon clouds and a flying shark in the browser; checks it hunts by the rules
PORT=8080 BOTS=30 node scripts/loadtest.mjs   # bot players against a running server
```

With 30 bot players walking around, the server ticks in about 8 ms (11 ms at peak while terrain
is being generated), well inside the 50 ms tick budget.

## What the base game covers

**World**
- Infinite horizontal world, 128 blocks tall, in 32×32×32 chunks, streamed around each player
- Deterministic terrain from the seed: oceans, beaches, plains, forests, deserts, snowy plains, mountains
- Caves (tunnels and large caverns), ores by depth (coal, iron, gold, diamond), gravel pockets, bedrock floor
- Trees, tall grass, flowers, cactus, ice on snowy water
- Day/night cycle (20 minutes), sun, moon, stars, clouds; smooth lighting from the sky and from torches
- World saves to disk every 30 s and on shutdown; players' inventories and positions are saved

**Playing**
- Walk, sprint, jump, swim; creative flight (double-tap Space)
- Mining with Minecraft's dig-time rules: hardness, the right tool, tool tiers (wood → stone → iron → diamond), tool wear
- Placing blocks; sand and gravel fall; plants and torches need support; saplings grow into trees; grass spreads
- 33 blocks and 34 other items (67 in total), including wood, stone, iron and diamond tools and swords; 28 crafting recipes and 9 smelting recipes
- Crafting in a 2×2 grid (inventory) or 3×3 (crafting table), shaped and shapeless recipes, shift-click crafting
- Furnaces (fuel, smelting ores, cooking food, glass, stone, bricks) and chests (shared between players)
- Survival: health, hunger, regeneration, fall damage, drowning, cactus damage, eating, death drops and respawn
- Mobs: pigs, cows and chickens (wander, flee, drop food); zombies (chase at night and in caves, burn in daylight); creepers (hiss, then explode)
- Melee combat with knockback and jump-crits; PvP is off unless an admin turns it on (`/pvp on`)
- TNT lit with flint and steel, chain reactions, craters
- Survival and creative modes; creative inventory with every item
- Multiplayer: see other players with name tags, chat, shared world changes in real time

**Commands**: `/help`, `/gamemode`, `/give`, `/tp`, `/time set`, `/spawn`, `/setspawn`, `/kill`, `/seed`,
`/list`, `/summon`, `/unsummon`, `/pvp`, `/rule`, `/events`, `/modules`, `/module`, `/stats`

## Changing the world while people play

Rules and code change live, for everyone at once, as **world events**: no restart, nobody
disconnected. Each change gathers (announced with a countdown), arrives for the server and every
client in the same tick, and is then watched for 30 seconds. If it breaks something (a module
starts failing, the server slows down, lots of players die), it is undone automatically.

![A palette rule change arriving live](docs/screenshots/live-rule-change.jpg)

**Rules** are the values in [docs/standards/defaults.json](docs/standards/defaults.json): gravity,
speeds, damage, the colour palette and more.

```
/rule list balance.player          see the current values
/rule set balance.player.jumpBlocks 4
/rule set art.palette.green2 #c04090    (leaves turn pink: textures repaint live)
/rule undo                          roll back the latest rule change
/events                             what's happening and what changed recently
```

Locked values (health, safety and performance limits) can't change; a value must keep its type
and can change by at most 10× at once. Changes are saved with the world.

**Code**: drop a module file into `data/<world>/modules/` (this is what an agent will do) and it
arrives the same way. While gathering it is compiled, imported fresh, and **shadow-run** for 2 s
of game time against the real world with all its writes thrown away; files that don't load, throw,
try to import other code, or take more than 5 ms per tick fizzle and never reach the world.

```
/module examples                    chicken-rain, feather-fall, broken-on-purpose, typo
/module install chicken-rain        chickens fall from the sky every 20 s
/module install broken-on-purpose   arrives, starts failing, gets undone automatically
/module remove example:chicken-rain
/module off vanilla:mobs            vanilla modules can be switched off and on too
```

![A broken module undone automatically](docs/screenshots/auto-undo.jpg)

Normally changes are spaced out (one at a time, 20–60 s apart, palette/art changes 10 minutes
apart, per the pacing standards). Start the server with `EVENT_PACING=fast` to try things quickly.

A module is a file that `export default`s `{ id, name, version, author, description, setup(api) }`;
see [examples/modules/](examples/modules/) and the `ModuleApi` in
[packages/server/src/api.ts](packages/server/src/api.ts).

## Summoning things

`/summon <anything>`: `/summon a big cloud`, `/summon a flying shark`, `/summon a storm cloud`,
`/summon three angry wolves`, `/summon a cute pink dragon`, `/summon a jellyfish`… Each summon is a
world event:

1. **Plan**: the request becomes a *summon spec*: body plan (cloud, fish, bird, quadruped, blob),
   size, colours from the world palette, features (teeth, fins, wings, horns…), how it moves
   (drift, fly, swim, walk, hover), temperament and abilities (bite, rain). Today a simple
   keyword planner does this; a player's agent will write specs directly.
2. **Fit to the rules**: too big, too many, or a hostile thing that's too large gets scaled back,
   with a note saying so.
3. **Generate the 3D model** in code (`packages/shared/src/summons/generate.ts`): voxel parts
   (body, tail, fins, wings, legs) that animate, greedy-meshed. Server and every client build the
   same model from the spec.
4. **Check the model** against the art standards: size category and triangle budget, palette and
   reserved colours, back/belly contrast, and a silhouette test for clouds.
5. **Shadow playtest** the behaviour on the real terrain with three virtual players (one stands
   still, one sidesteps when warned, one runs). It fails if a bite comes without enough warning,
   hits harder than the cap, comes before the cooldown, or can't be dodged.
6. **Arrive** where it suits: clouds high above the ground, flyers a few blocks up, swimmers in
   nearby water (or it explains it needs water).

| Model review (viewer) | In the world |
|---|---|
| ![Flying shark in the viewer](docs/screenshots/viewer-flying-shark.jpg) | ![Flying shark circling](docs/screenshots/summon-flying-shark.jpg) |
| ![Big cloud in the viewer](docs/screenshots/viewer-big-cloud.jpg) | ![Storm cloud raining](docs/screenshots/summon-storm-cloud.jpg) |

**Default behaviours** come from the fun and balance standards:
- **Clouds** drift slowly about 22 blocks above the terrain and stay near where they were made;
  storm clouds rain. They're scenery: they can't be attacked and don't hurt anyone.
- **Hunters** (a flying shark, a red dragon, angry wolves) circle visibly first. Then, only with a
  clear line to you and within reach, they hover, **pulse in the danger colour and hiss** for at
  least the warning time (1 s for heavy bites), and lunge in a straight line you can sidestep.
  After a bite they retreat and wait a cooldown.
  - They're slower than a walking player, so running works, and they give up after 32 blocks.
  - Trees and caves shelter you.
  - They never hunt within 24 blocks of spawn or anyone in creative.
  - Bites are capped at 40% of health.
- **Neutral** creatures fight back when hit; **passive** ones flee.
- **Limits**: 6 summons per player, 40 per world, 3 hostile ones at a time (the hazard limit).
  `/unsummon` removes yours.

![The shark warning before it dives](docs/screenshots/summon-shark-warning.jpg)

Review generated models without starting the game:
`npm run build && npm run view:summons "a flying shark" "a big cloud"` renders each prompt from
several angles, as a silhouette at 20 m, and next to a player and a tree for scale, with the
checks report (images in `test-results/summons/`, or open `/viewer.html?prompt=…` in the browser).

## How the code is organised

```
packages/
  shared/   game rules used by both sides: content registry, chunks, terrain generation,
            physics, raycasting, crafting and windows, dig/drop rules, network protocol,
            and the vanilla content pack (blocks, items, recipes, textures-as-code, mob models)
  server/   authoritative server: the kernel (module host), world store and persistence,
            terrain worker threads, networking, and the vanilla gameplay modules
  client/   browser client: Three.js renderer, mesher workers, player controller, HUD and UI
docs/       architecture and the world standards
scripts/    end-to-end browser test
```

The base game is itself a set of modules (`packages/server/src/modules/vanilla/`):
`nature`, `building`, `explosives`, `items`, `survival`, `combat`, `mobs`, `containers`, `summons`, `commands`.
Each one only uses the `ModuleApi` (`packages/server/src/api.ts`), the same surface agent-written
modules will get. The kernel tags every handler with its module, so a module can be switched off
(`/module off vanilla:mobs`) and its errors are contained: a module that keeps throwing is switched
off automatically and announced as a world event, instead of crashing the server.

## What's not built yet

Compared with Minecraft: flowing water and lava, farming, beds, doors, ladders, armour, bows,
sheep/wool from animals, the Nether/End, redstone, villages. Blocks with a front face (furnace,
chest) always face south for now.

Compared with the architecture: per-player agent sessions (the world-event pipeline they will
use is built), process-level sandboxing of module code (today module code runs in the server
process; the shadow run, import ban, error containment and CPU budget limit the damage, but a
determined module could still misbehave; V8 isolates are the next step), client-side (visual)
modules, and server-side entity lighting.
