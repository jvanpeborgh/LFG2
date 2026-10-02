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
`/list`, `/summon`, `/pvp`, `/modules`, `/module on|off <id>`, `/stats`

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
`nature`, `building`, `explosives`, `items`, `survival`, `combat`, `mobs`, `containers`, `commands`.
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
