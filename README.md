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
your network can join at `http://<your-ip>:8080` (set `PUBLIC_URL` to that address so invite
links point there).

### Starting out, and bringing friends

- **Your name is yours.** The first time you play, your browser makes a secret key and claims the
  name, so nobody else can turn up as you (or as the owner of your worlds). To play on another
  device, type `/device` in game and enter the code under **Sign in with a code** there.
- **The title screen** takes you straight in. **Continue in …** brings you back to where you were.
  **Worlds** lists the public ones and yours. **Create a world** makes one from a name and a few
  words ("a cozy snowy forest with glowing mushrooms"). You pick a look, who can join (anyone, or
  only people you invite) and the time it starts at.
- **Invites**: in game, press Esc and choose **Invite friends** (or type `/invite`) for your link
  (`/?join=<code>`). A friend who opens it sees who invited them, joins with one click and arrives
  right next to you. Everyone hears who brought them. The first time, you both get XP (the inviter
  up to 5 friends a day). In an invite-only world the link is the way in, and invited friends can
  come back without it. `/world access public|invite` changes who can join.
- **Friends**: whoever joins with your invite becomes your friend (or ask with `/friend <name>`;
  they accept with `/friend <you>`). You hear when friends come online and where. The title
  screen's **Friends** box lists who's online and joins one in a click, next to them. In game,
  Esc shows your friends: **Go** for one in this world (`/visit <name>`), **Join** for one in
  another (if it's public, or you're a member). `/friends` lists them, `/friend remove <name>`.
- **Gifts**: `/gift <friend> <anything>` (or **Gift** in the friends list) summons it next to a
  friend in this world. You pay, it's theirs, and it follows them around.
- **First steps**: someone new to a world gets a short checklist in the corner: look around,
  summon a creature, imagine something (when the server has a key), invite a friend, and play
  together. Each step gives a little XP. `/steps` hides it.

`node scripts/e2e-friends.mjs` runs all of this in two browsers: Ana makes an invite-only world,
Ben opens her link and lands next to her, Ben's next visit offers **Continue**, and someone else
can't take Ana's name. Screenshots go to `test-results/friends/`.

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
| `TRANSCRIBE_URL`, `TRANSCRIBE_API_KEY`, `TRANSCRIBE_MODEL` | *(off)* | Speech-to-text for voice commands (see "Voice commands") |
| `PUBLIC_URL` | `http://localhost:<PORT>` | The address players reach the server at (used in /link instructions and world links) |
| `MAX_WORLDS` | 10 | How many worlds the server holds |
| `ANTHROPIC_API_KEY` | *(off)* | Claude designs what players describe with `/imagine` (see below) |
| `DESIGNER_DRAFT_MODEL`, `DESIGNER_POLISH_MODEL` | `claude-sonnet-5-5`, `claude-opus-5-5` | The fast first pass and the background polish (an empty polish model turns the polish off) |
| `DESIGNER_RENDERS` | 2 | How many times the draft may look at its render before saving |
| `IMAGINE_DAILY`, `IMAGINE_WORLD_DAILY`, `IMAGINE_PREDESIGN_DAILY` | 10, 200, 5 | Designs per player per day, per world per day, and popular prompts designed ahead each day |

Settings can also go in a `.env` file at the repository root (git-ignored; copy
`.env.example`). The server reads it at startup, and real environment variables win.

Type commands into the server console too (e.g. `time set night`, `modules`).

### Claude as the designer (`/imagine`)

With an Anthropic API key, players can describe anything in as much detail as they like and
Claude makes it:

```sh
cp .env.example .env    # then put your key after ANTHROPIC_API_KEY=
npm run build && npm start
```

In game: `/imagine an ancient obsidian salamander the size of a wagon with six stubby legs, glossy
black plates with glowing magma cracks, a crest of crystal spines and a tail ending in a molten crystal`.

What the player sees:
1. **At once:** the bestiary's take on it arrives as a stand-in, as `/summon` would make it.
2. **In about 20–40 s:** a fast model (Sonnet 5.5) has drafted the design, and the stand-in
   morphs into it where it stands.
3. **About a minute later:** a stronger model (Opus 5.5) has polished it, and it morphs again.

The draft runs a short loop with the same tools an agent has over MCP:
- it reads the design guide and best practices, and starts from the bestiary's brief when there is one;
- it builds from named parts where it can: a `base` body (horse, bear, knight, dragon…) and a `kit`
  of features (saddle, lantern, horns, wings…), and writes its own primitives only for the rest;
- `render_design` checks the design against the world's rules and shows Claude the render together;
- `edit_design` makes small changes (`set`, `add` or `remove` at a path) instead of rewriting the whole design;
- `save_design` saves it. Claude gets two looks, then saves.

The world remembers what was imagined. The same words again (from anyone, with `/imagine` or
`/summon`) bring back that design at once. A close match is handed to Claude to edit rather than
start over. Prompts asked for three or more times are designed ahead of time, a few a day.

Each `/imagine` costs a tier-1 cast's aether, refunded if it fails, and the stand-in pays its own
summon. Players and the world have daily caps (the `IMAGINE_*` settings above). Anyone can summon a
design again with `/summon design:<id>`. The server log says `Claude designs /imagine requests`
when the key is picked up. `DESIGNER_DEBUG=1 node scripts/e2e-imagine.mjs "<description>"` tests
the whole thing in a browser, with timings and a screenshot of each stage.
Without a key, `/imagine` says so, and `/summon` works as before.

## Checks

```sh
npm run typecheck   # TypeScript, all packages
npm test            # unit + server integration + gameplay tests (vitest)
npm run build && npm run e2e   # two players in headless Chromium, saves screenshots to test-results/
npm run e2e:rules              # two players; one changes rules and adds code, the other sees it live
npm run e2e:summons            # summon clouds and a flying shark in the browser; checks it hunts by the rules
npm run e2e:scenario           # a pirate raid in the browser: ships sail in, waves, a boss, a reward
npm run e2e:voice              # voice summons with a fake microphone, levels, a ritual joined with J
npm run e2e:builds             # a village, a mountain city and the power of a wizard in the browser
npm run e2e:mcp                # a chat (MCP client) links, inscribes scrolls, casts, creates and opens a world
npm run e2e:theme              # a "cyberpunk sci-fi samurai" world from words and a reference image, next to the base world
npm run e2e:designs            # a chat designs creatures (brief, check, critique, render, save); summoned, restyled smooth, then sculpted by a player's setting
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
`/list`, `/summon`, `/unsummon`, `/event`, `/ritual`, `/join`, `/progress`, `/cost`, `/build`, `/keep`, `/powers`, `/link`, `/unlink`, `/inscribe`, `/cast`, `/scrolls`, `/worlds`, `/world`, `/xp`, `/aether`, `/pvp`, `/rule`, `/events`, `/modules`, `/module`, `/stats`

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
`/summon three angry wolves`, `/summon a cute pink dragon`, `/summon a pirate ship`, `/summon a viking`… Each summon is a
world event:

1. **Plan**: the request becomes a *summon spec*: body plan (cloud, fish, bird, quadruped, blob, biped, ship),
   size, colours from the world palette, features (teeth, fins, wings, horns…), how it moves
   (drift, fly, swim, walk, hover), temperament and abilities (bite, breath, shot, charge, stomp, rain). Today a simple
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
- **Attacks** beyond the bite, picked by name (`abilities`) or read from the words
  ("fire-breathing", "spits", "archer", "charging", "stomps"). The world's rules set the damage,
  range and warning for each. Each one has a pose that shows what's coming, and a way out:

  | Attack | Warning | What lands | Way out |
  |---|---|---|---|
  | breath | rears back, jaw opening, sparks at the mouth | a cone (fire, frost, poison, lightning…) rolling out for a second | step out of the cone or behind cover |
  | shot | draws back (bipeds draw a bow) | a projectile flying straight at where you were | sidestep it |
  | charge | head down, pawing the ground | a straight rush; a wall dazes it for a moment | step aside (lure it into a wall) |
  | stomp | rears up, a danger ring on the ground | a shockwave in the ring | step out of the ring |

  It stops turning to follow you 0.3 s before the attack lands: that's the moment to move. The
  shadow playtest's sidestepping player has to be able to dodge every attack. A creature with no
  bite keeps its distance and circles. Its element comes from its words ("an ice dragon" breathes
  frost) or the design's `element`.
- **Idle life**: when they aren't fighting, creatures do things, each with its own pose:
  grazers graze, animals sniff about, dogs, cats and people sit, and everything that walks sleeps
  at night (lying down, with slow deep breaths and drifting "z"s). A sleeping hunter only notices
  you right next to it. A hunter that spots you roars first, which is a warning that it's coming.
  Heads turn to look at players close by. Creatures summoned together stay together as a herd.
  Birds and other winged things land and perch for a while, and sleep perched. Swimmers leap clear
  of the water and swim in schools. Bats, owls and ghosts are up at night and sleep by day.
  Floating things drift over to visit.
- **Character**: each design is curious (comes over to see who's there), shy (keeps its distance
  and bolts if you get close) or calm. Prey keeps away from hunters, and now and then a creature
  wanders over to sniff another. Everything has a voice, heard now and then up close: birds
  chirp, beasts low, small animals yip, people murmur, fish blow bubbles, slimes squelch, insects
  buzz, spirits moan, and sleepers snore. `node scripts/e2e-life.mjs` films a meadow over a day,
  a wolf's visit and a night as a timelapse (`test-results/life/timelapse.png`).
- **Mounts**: ride what you summon, if it's big enough to carry you. Look at it and right-click to
  climb on; C gets you off. How it rides comes from what it is: horses and big cats gallop
  (Shift goes faster) and jump, dragons and big birds fly where you look (Space climbs), dolphins
  and sharks swim, ships sail, giants carry you on their shoulders. Ask for one *to ride* ("a
  dragon I can ride", "a saddled horse", "a beetle mount") and it comes tame, big enough and
  saddled. Only your own summons let you on; the mount takes the jolt of landing, and swimmers keep
  you breathing. Everyone sees you sitting on it. `node scripts/e2e-mounts.mjs` rides a horse and a
  dragon.

  ![Riding a horse](docs/screenshots/mount-horse.png) ![Riding a young dragon](docs/screenshots/mount-dragon.png)
- **Vehicles**: imagine something to drive and get in: karts, cars (sports cars, taxis), trucks
  and jeeps (monster trucks), buggies, motorbikes, in any colour ("a neon green kart", "a pink
  jeep"). Right-click to get in, W to go, S to brake and reverse, A/D to steer, Shift to drift (the
  back steps out, smoke and squealing tyres), C to get out. The camera follows the car (the mouse
  looks around and eases back); it hops up one-block kerbs, and the engine climbs with your speed.
  Wheels spin and the front ones steer. Parked, a vehicle waits where you left it.

  ![Vehicles](docs/screenshots/vehicles.png)
  ![Driving a kart](docs/screenshots/drive-kart.png)
- **Races**: `/race` (or `/race a mario kart course, 5 laps`, `/event a buggy rally`, or just
  `/summon a kart race`) lays a course on the flattest ground near you:
  - **The course:** a loop of road with a dashed centre line, red and white kerbs, a checkered
    start line under a gate, lantern posts at each checkpoint and lanterns along the side.
    Trees over the road are cleared.
  - **The start:** everyone within 48 blocks gets a kart of their own colour on the grid, then a
    3-2-1 countdown.
  - **The HUD:** lap, place, a running time, and an arrow to the next checkpoint (a gold beacon
    marks it). Checkpoints count only in order, so shortcuts don't pay. Fall off or get lost in
    your kart and you're put back at your last checkpoint after a moment.
  - **The finish:** placings and prizes (diamonds for the winner).
  - **Clean-up:** the karts go and every block the course changed is put back, even after a
    restart. `/race stop` calls it off.
  - `node scripts/e2e-race.mjs` races in the browser.

  ![A race course from above](docs/screenshots/race-course.png)
  ![On the grid](docs/screenshots/race-grid.png)
- **Happenings**: change the world's rules for a while, for everyone:
  - **The catalogue:** low gravity (jump three times as high, fall softly), speed world,
    trampoline day, ice world (you slide), peace day (nobody gets hurt), eternal night, endless
    day, and the floor is lava (natural ground burns; stand on what you've built).
  - **How to start one:** `/happen low gravity for 10 minutes`, `/event an ice world`, or just
    `/summon low gravity`. `/happen list` shows them all.
  - **Fairness:** it's everyone's world, so an admin (or someone playing alone) starts one at once;
    otherwise everyone online votes (`/vote yes|no`, 20 s).
  - **On screen:** a banner, and a bar with the time left.
  - **Clean-up:** when time's up, or `/happen stop`, every rule goes back exactly as it was, even
    across a restart.
  - `node scripts/e2e-happenings.mjs` jumps in low gravity.
- **Creature gear** (docs/CREATURE-LOOT.md): what you defeat can drop gear made from it:
  - **What drops:** a red dragon's scales become an *Emberscale Helm*, a shark's tooth becomes
    *Sharkfang*, a ghost leaves a lantern. Bosses always drop two pieces; fighters often drop one,
    more often the stronger they were; pets rarely drop anything.
  - **How good it is:** from the creature's tier and your level. Rarity runs common, uncommon,
    rare, epic, legendary.
  - **Perks** come from what the creature was: fire resistance from fire creatures, water
    breathing from fish, light falls from flyers, swiftness from fast creatures, night eyes from
    nocturnal ones, and burning, chilling, venomous or shocking hits for elemental weapons.
  - **Lore** says whose creature it was, who felled it and on which day, with a line of flavour.
  - **Looks:** pieces are painted in the creature's colours, and the tooltip shows the name in
    its rarity colour, the stats, the perks and the lore.
  - **Wearing it:** right-click with a piece in hand to put it on; everyone sees it on you.
    Armour blocks a share of hits (up to 60% for a full set). `/gear` lists what you wear;
    `/gear off <slot>` takes a piece off. Gear is saved with you, and can be gifted.
  - **Testing:** `/loot <creature> [kind]` (admins) makes a piece; `node scripts/e2e-gear.mjs`
    wears a dragon set.

  ![Wearing red dragon gear](docs/screenshots/gear-worn.png) ![A piece's tooltip](docs/screenshots/gear-tooltip.png)
- **Body language**: creatures blink now and then (and shut their eyes to sleep). Ears and
  antennae flop back as they set off and bounce when they stop or land; tails swing out on turns;
  the head leads into a turn; walkers lean into it and flyers bank.
- **Companions**: `/follow` makes your summons follow you (they hurry to keep up, and catch up if
  they fall 16 blocks behind, say when you fly or teleport away); `/stay` leaves them where they
  are.
- **Neutral** creatures fight back when hit; **passive** ones flee.
- **Limits**: 6 summons per player, 40 per world, 3 hostile ones at a time (the hazard limit).
  `/unsummon` removes yours.

![The shark warning before it dives](docs/screenshots/summon-shark-warning.jpg)

`node scripts/animation-sheets.mjs` draws contact sheets of how they move: walk cycles, the idle
actions, and each attack's warning and strike (in `test-results/animation/`). The viewer takes
`?action=sleep` or `?attack=breath&active=1` to show a pose.

**The Creature Lab** (`/lab.html`, or a static build with `cd packages/client && LAB=1 npx vite build`
into `dist-lab/`) runs the creature code in the browser without a server: a meadow with a pond
where you add creatures by name, change the time of day, stand among them (and let hunters hunt
you), and make one show its poses and attacks. `node scripts/lab-check.mjs` opens the build and
takes screenshots.

Review generated models without starting the game:
`npm run build && npm run view:summons "a flying shark" "a big cloud"` renders each prompt from
several angles, as a silhouette at 20 m, and next to a player and a tree for scale, with the
checks report (images in `test-results/summons/`, or open `/viewer.html?prompt=…` in the browser).

## Scenarios: invasions in waves

`/event a swarm of ships arrive at the nearest coast and enemies come out in waves, with increasing
difficulty and some bosses` (or `/event vikings raid the coast in 3 waves`, `/event a ghost fleet
attacks with a boss`; `/summon` passes these on too). A scenario is a world event with a story arc:

1. **Plan** a *scenario spec*: a theme (pirates, vikings, skeletons), how many ships, the waves
   (more enemies each wave, brutes from wave 3), a final boss (and one mid-way) when you ask
   for bosses, a final boss in raids of 4+ waves anyway, breaks, a reward. Sizes scale with the number of players nearby (by √players).
2. **Find the nearest coast** with open sea in front of it, outside the spawn safe zone: a low
   beach, water deep enough for a keel to anchor in, and a clear lane out to sea for each ship.
3. **Check** every model (ship, raiders, brutes, bosses) against the art standards.
4. **Shadow playtest every wave** on the real terrain against virtual defenders who fight back and
   (sometimes) dodge, with the same enemy brains the server runs. It fizzles if a hit is over the
   cap, a boss slam hits someone who was already stepping out, or a wave can't be finished, and
   reports too many deaths or difficulty that doesn't build up.
5. **Run it live**: the ships appear out at sea and sail in, dropping anchor in the shallows.
   Raiders jump off a few at a time (at most 8 on the field), wade ashore and go for the nearest
   defenders. Bosses get a health bar and a ground slam with a ring you step out of. Between waves
   there's a 15 s breather. Win and a reward chest appears on the beach; if everyone leaves (or
   time runs out) the raiders give up. Either way the ships sail away and everything is cleaned up.

| Ships sail in | Wave 1 comes ashore |
|---|---|
| ![Three pirate ships sailing in](docs/screenshots/raid-ships.jpg) | ![Raiders wading ashore](docs/screenshots/raid-wave.jpg) |
| **The final boss, with its health bar** | **Victory: the ships leave** |
| ![The Pirate King coming ashore](docs/screenshots/raid-boss.jpg) | ![The ships sailing away](docs/screenshots/raid-victory.jpg) |

Review the cast without playing: `npm run view:summons "pirates raid in 5 waves with bosses :: final"`
(or `:: ship`, `:: grunt`, `:: brute`, `:: boss`).

![The Pirate King in the viewer](docs/screenshots/viewer-pirate-king.jpg)

The HUD shows the wave, how many are left, and an arrow with the distance to the beach, for
everyone in the world. `/event stop` calls it off (whoever started it, or an admin). One scenario
runs at a time, and it counts as one hazard against the hazard limit.

## Levels and summoning power

What you can summon grows with your level (the full design is in
[docs/standards/progression-and-power.md](docs/standards/progression-and-power.md)):

- **Tiers.** Every summon or scenario is rated by what it would actually be (size, numbers,
  danger, bosses, weather), from tier 1 (a pig, a cloud) to tier 5. Levels 1, 4, 8, 12 and 17
  unlock tiers 1–5. Ask above your tier and you get the biggest version you can cast, with a note:
  *"Red Dragon is tier 3 (5 blocks long, hostile, heavy hits): it needs level 8, or a ritual"*.
- **Rituals.** `/ritual a red dragon` opens a circle; others stand in it and press **J** (or
  `/join`). Each helper adds 2 levels, up to one tier above the leader; the cost is shared and
  helpers get XP.
- **Aether and shards.** Casting costs aether (a bar of 100 that refills 1 a minute, slower
  offline): 5, 15, 35, 60 or 100 by tier. Tiers 3+ also cost aether shards, from bosses and won
  scenarios. If a summon fizzles you get 75% back.
- **XP.** About 40 hours to level 20, fast at first. A little from normal play (capped per
  minute), most from shared moments: defending raid waves, beating bosses (split by damage),
  winning, joining rituals, and other players spending time with or fighting what you summoned.
- **Tuning.** XP rates, costs and refill speed are world rules (`/rule set progression.…`); the
  level cap, the tiers and the levels that unlock them are locked.
- `/progress` shows yours; admins can use `/xp give|level`, `/aether fill|shards`.

### Epic builds and powers

- **Builds**: `/summon a village`, `/summon a castle`, `/summon a wizard tower`,
  `/summon a city with a whole civilization on the mountainside`. They rise from the land in
  front of you (never over anything players built, or the spawn area), villages and cities with
  villagers. They last 72 hours unless other players adopt them (spend a minute there, or
  `/keep`), then fade back, restoring the land. `/build list | here | expire`.
- **Powers**: `/summon the power of a wizard` (fire bolt R, blink F, frost nova G, night vision;
  10 min), `wings` (flight in survival, 3 min), `swiftness`, `night vision`, `water breathing`,
  and once a day, `become an avatar of the storm`. Everyone sees an aura on a powered player.
- **Costs**: `/cost a huge kraken` says the tier, the level it needs, aether, shards and AI
  budget, what you'd get at your level, and how many ritual helpers it would take.

| A village (tier 4) | Inside a city (tier 5) | The power of a wizard |
|---|---|---|
| ![Village](docs/screenshots/build-village.jpg) | ![City street](docs/screenshots/build-city.jpg) | ![Wizard](docs/screenshots/power-wizard.jpg) |

## Preparing summons in ChatGPT or Claude (MCP)

The server includes an [MCP](https://modelcontextprotocol.io) server at `/mcp`, so people can
work out what they want to summon in a chat with ChatGPT, Claude or any other MCP client, see
what it would cost, and load it into the game as **scrolls** in their spellbook.

1. In game, type `/link`: you get a one-time code (works once, for 10 minutes).
2. Add the MCP server to your chat app with the URL `https://<your server>/mcp`. In Claude, add it as
   a custom connector. In ChatGPT, add it as a connector (developer mode). In Claude Code, run
   `claude mcp add --transport http lfg2 http://localhost:8080/mcp`. Chat apps that run in the cloud
   need a public HTTPS address, so for a server on your own machine use a tunnel.
3. Ask the chat to "link my player with code K7Q-M3P". It acts for that player in that world
   only. `/unlink` disconnects every linked chat.

What the chat can do:

| Tool | What it does |
|---|---|
| `get_world_guide` | The tier ladder (levels, aether, shards, AI budget), everything the world can make (creatures, raid themes, builds, powers), its look and rules, so prompts fit the world |
| `estimate_cost` | What a prompt makes, its tier and the level it needs, the full cost, what you'd get at your level, ritual helpers needed, and what inscribing it costs. Refining prompts in the chat is free |
| `inscribe_scroll`, `list_scrolls`, `remove_scroll` | Save a prompt as a named scroll. Inscribing checks it the way casting will and costs a fifth of its casting aether; scrolls appear in game at once. Works while you're offline |
| `cast_scroll` | Cast a scroll where you stand (you must be in the world): full price, a normal world event |
| `get_progress` | Level, XP, aether, shards, tier, next unlock |
| `create_world`, `configure_world`, `open_world`, `list_worlds` | Make a world of your own with a look (a theme from words and reference images, or a palette preset), a starting time, day length, PvP and other rules. It stays closed (only you can join) until you open it |
| `preview_theme` | What a theme would do (palette, materials, light, music, build style, raid theme) before creating anything |
| `get_design_guide`, `check_design`, `render_design` | Design something new instead of describing it: the chat writes a model as parts made of primitives, checks it (issues come back with JSON paths and fixes, plus a playtest), and looks at renders in the world's style |
| `interpret_prompt`, `get_design_skill` | The art director: words → a brief (skill, mood, style, what must read) and a starting design from the game's design skills, which are also SKILL.md files a chat can keep |
| `get_structure_guide`, `check_structure`, `render_structure`, `save_structure`, `list_structures` | Write a building as primitives made of blocks (hollow rooms, cut doors and windows, repeats for pillars); checked, previewed, saved; players raise it with `/summon structure:<id>` (`/structures` lists them) |
| `get_raid_guide`, `check_raid`, `save_raid`, `list_raids` | Write a raid instead of describing it: ships, waves of prompts or designs, bosses, a reward. It's checked (paths and fixes, pacing) and every wave is playtested; players start it with `/event raid:<id>` (`/raids` lists them) |
| `save_design`, `list_designs`, `remove_design` | Save a design to the world: anyone there can `/summon design:<id>`, and a scroll can hold `design:<id>` |

In game, press **K** for the spellbook (cast with a click), type `/cast <name>`, or say
*"cast kraken storm"*. `/inscribe <name> = <prompt>` makes scrolls without a chat, and `/scrolls`
lists them.

![Spellbook with scrolls from a chat](docs/screenshots/spellbook.jpg)

**Themes**: `create_world` (and `preview_theme`, which changes nothing) take a `theme` in words and
`reference_images` (or `reference_colors`). *"A cyberpunk sci-fi samurai inspired world"* gets
sakura-pink trees, dark-teal ground, vermilion wood, a violet night sky, pagoda villages with neon
strips, ninja raids and music in A minor. Everything else stays shared. See
[docs/standards/world-themes.md](docs/standards/world-themes.md) for what a theme sets, its
safeguards, and what it means for the base world.

| Base world | The same spot in a cyberpunk samurai world |
|---|---|
| ![Base](docs/screenshots/theme-base.jpg) | ![Neo-Kyoto](docs/screenshots/theme-pagoda-village.jpg) |

**Worlds**: a server can run several worlds. Join one with `?world=<name>` in the address or pick
it on the title screen. `/worlds` lists them, and `/world open` opens yours. Levels and spellbooks
are per world. Worlds nobody is in are unloaded after 10 minutes. Created worlds belong to their
creator, who is their admin. A player can create 2, and a server holds up to `MAX_WORLDS` (10).

### Designing new things, and styles beyond voxels

Describing a summon uses the game's own planner. A chat can also **design** one: the model, as
parts built from primitives (capsules, cones, wedges…) with animation roles. It checks the design
and looks at renders, as many times as it likes for free, then saves it to the world. See
[docs/AI-INTEGRATION.md](docs/AI-INTEGRATION.md) for the loop, and a review of every component for
when a real model writes specs.

Creatures don't have to be blocky either. The world rule `art.modelStyle` draws them `smooth`,
`lowpoly` or **`sculpted`**: designs drawn from their primitives with smooth joins, gloss, metal
and glowing finishes, and up to 4× the triangle budget up close (a simpler version takes over
further away). A theme with words like *claymation*, *low-poly* or *figurine* sets the world's
style, and `/rule set art.modelStyle sculpted` changes it live. **A prompt can choose too**:
*"a low-poly wolf"* or *"a sculpted dragon"* is drawn that way for everyone, next to creatures in
the world's style, unless the world turns prompt styles off (`art.promptStyles false`).

Designs can use curving **tubes** (tails, horns, tentacles), **repeated** rows (spines, teeth),
and **rounded, tapered or twisted** primitives. Creatures get baked shading in their creases,
reflective gloss and metal, glow that haloes at night, and soft shadows on the ground.

**For agents**: [docs/AGENT-BEST-PRACTICES.md](docs/AGENT-BEST-PRACTICES.md) is the guide to
making things that look good and pass the checks. It covers the loop, the prompt words that matter,
proportions by mood, a primitive cookbook, colour, style, and the mistakes to avoid. It came out of
a quality loop over a benchmark set and is served to chats as the `design-best-practices` skill.

![Benchmark set](docs/screenshots/benchmark-sheet.jpg)

**Design skills** make results consistent: `interpret_prompt` reads "a cute pink dragon" as the
winged-creature skill in a cute mood. It returns a brief and a starting design (big head, round
forms, horns and a tail), and the checks then critique the design against that brief.

| Lantern moth, sculpted | The same moth at night (glowing belly) | "A cute pink dragon", from its brief |
|---|---|---|
| ![Moth](docs/screenshots/sculpted-moth.jpg) | ![Moth at night](docs/screenshots/sculpted-moth-night.jpg) | ![Dragon](docs/screenshots/skill-cute-dragon.jpg) |

| A design summoned in game | The same world after `/rule set art.modelStyle smooth` | A design rendered low-poly |
|---|---|---|
| ![Moss golem](docs/screenshots/design-golem-ingame.jpg) | ![Moss golem, smooth](docs/screenshots/design-golem-ingame-smooth.jpg) | ![Paper crane](docs/screenshots/design-crane-lowpoly.jpg) |

## Voice commands

Hold **B** (or the 🎤 button in the corner) and say what you want: *"summon a flying shark"*,
*"start a ritual to summon a red dragon"*, *"join the ritual"*, *"start an event where pirates
raid the coast in three waves"*, *"make me a wizard"*, *"how much would a village cost"*, *"cast kraken storm"*, *"stop the raid"*,
*"what's my level"*. Release, and the panel
shows what was heard and the command it becomes; commands go after 2 seconds (Enter: now, Esc:
cancel). Anything that isn't a command becomes a chat line, and waits for Enter.

| What was heard | A ritual circle to join |
|---|---|
| ![Voice panel](docs/screenshots/voice-heard.jpg) | ![Ritual circle](docs/screenshots/ritual.jpg) |

Speech becomes text in one of two ways (Settings → Voice: Automatic / Game server / This browser / Off):

- **Game server** (used automatically when set up): the clip is recorded in the browser and sent
  to the game server, which forwards it to an OpenAI-compatible transcription endpoint and returns
  the text. Works in every browser with a microphone. Set it up with environment variables:

  | Variable | Meaning |
  |---|---|
  | `TRANSCRIBE_URL` | e.g. `https://api.openai.com/v1/audio/transcriptions`, Groq's, or a self-hosted Whisper server (whisper.cpp / faster-whisper-server) at `http://localhost:8000/v1/audio/transcriptions` |
  | `TRANSCRIBE_API_KEY` | the key for it (or set `OPENAI_API_KEY` alone to use OpenAI) |
  | `TRANSCRIBE_MODEL` | model name (default `whisper-1`) |

  Only players connected to the game can use it (a token per session), clips are at most 2 MB,
  12 a minute per player, and audio is never stored. The game's vocabulary is sent as a hint.
- **This browser**: the Web Speech API (Chrome, Edge, Safari), with live text while you speak.
  Nothing goes to the game server, but the browser maker does the recognition.

The microphone is only open while you hold the key or button.

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
`nature`, `building`, `explosives`, `items`, `survival`, `combat`, `mobs`, `containers`, `progression`, `powers`, `summons`, `scenarios`, `builds`, `spellbook`, `commands`.
Each one only uses the `ModuleApi` (`packages/server/src/api.ts`), the same surface agent-written
modules will get. The kernel tags every handler with its module, so a module can be switched off
(`/module off vanilla:mobs`) and its errors are contained: a module that keeps throwing is switched
off automatically and announced as a world event, instead of crashing the server.

## The world: sky, weather, exploring

- **Sky and light**: a gradient sky that glows towards the sun at sunrise and sunset, clouds that
  catch the sunset, warm golden-hour light and cool moonlight, torchlight that flickers, and glow
  (bloom) on bright things (a setting).
- **Wind and water**: leaves rustle and plants sway, harder in storms. Water has waves, reflects the
  sky at low angles and glints in the sun.
- **Weather**: rain (snow where it's cold) and thunderstorms come and go. Lightning shows a crackling
  ring for over a second before it strikes: step out of it. Rain makes plants grow faster. After rain
  the ground is dark and wet, with puddles that mirror the sky. Admins: `/weather clear|rain|thunder`.
- **Sun shafts and storm clouds**: with Glow effects on, shafts of light stream from a low sun
  through the trees (strongest at golden hour, gone when it's cloudy). Rain and storms bring a
  lower, darker, denser cloud deck that races by with the wind and flashes with lightning, hiding
  the fair-weather clouds; the sky goes slate. `node scripts/sky-shots.mjs` photographs both.

  ![Sun shafts](docs/screenshots/sun-shafts.png) ![Storm clouds](docs/screenshots/storm-clouds.png)
- **Sun shadows**: hills, trees, buildings, creatures and players cast shadows that stretch long
  in the morning and evening and swing round with the sun; they fade at dusk and under rain
  clouds. A setting (Sun shadows) turns them off on slow machines.

  ![Sun shadows](docs/screenshots/sun-shadows.png)
- **Coloured light**: each light colours what it touches: torches and lanterns warm, frost lamps
  cold, crystals violet, and neon in pink, green, blue and yellow. Where two lights meet, their
  colours mix. Lamps glow by themselves, day or night. Lantern = iron ingot + torch, frost lamp =
  ice + torch, crystal = glass + diamond (4), neon = glass + torch + poppy, cactus, ice or
  dandelion. Admins can place blocks with `/setblock` and `/fill`.

  ![Coloured light](docs/screenshots/coloured-light.png)
- **Sound of a place**: sounds come from where they happen (left, right, near, far). Rooms echo
  a little and caves a lot, and rain drums muffled on a roof and fades out deep underground.
  Footsteps sound like what you walk on (grass, stone, wood, sand, snow, gravel, water), and a
  hard landing thuds. Under it all is a soundscape: wind in the open (stronger up high and in
  storms), birds in the trees by day, crickets in the grass at night, water lapping by the shore,
  and drips and a low hum in caves.
- **Nights**: fireflies over the grass (not in the rain), stars, and the moon's cool light.
- **Ruins**: the broken walls of old shrines dot the land, about one every 60 blocks. Each has a
  chest in the middle with a cache of useful things, rarely a diamond, and some XP the first time
  it's opened.
- **Hits**: your hits show how hard they landed. Strike while falling for a critical hit: gold
  numbers, sparks and a ring.

`node scripts/graphics-shots.mjs` (with `WEATHER=rain` or `thunder`) photographs one view at noon,
sunset, dusk and night; `node scripts/light-shots.mjs` builds a wall of coloured lights and
photographs it at night and noon; `node scripts/e2e-sound.mjs` walks about for footsteps and
checks that a stone room sounds like a cave; `node scripts/shadow-shots.mjs` photographs a pillar
and an arch in morning, noon and afternoon sun. `node scripts/e2e-ruins.mjs` finds a ruin, opens its chest, and lands a
normal hit and a critical one. `docs/IMAGINE-BEYOND.md` covers what players could imagine beyond creatures (races, hunts, world events, rule changes, game modes from other games) and the event framework for it; `docs/REALISM-ROADMAP.md` covers what shader packs, mods and other
voxel games do, and what's next.

## What's not built yet

Compared with Minecraft: flowing water and lava, farming, beds, doors, ladders, armour, bows,
sheep/wool from animals, the Nether/End, redstone, villages. Blocks with a front face (furnace,
chest) always face south for now.

Scenarios: only invasions from the sea so far (the planner is a keyword stand-in for an agent
writing specs); raiders walk straight at you (no pathfinding, though stuck ones come ashore
again); losers simply vanish rather than rowing back; there's no sound for the boss slam yet.

Compared with the architecture: per-player agent sessions (the world-event pipeline they will
use is built), process-level sandboxing of module code (today module code runs in the server
process; the shadow run, import ban, error containment and CPU budget limit the damage, but a
determined module could still misbehave; V8 isolates are the next step), client-side (visual)
modules, and server-side entity lighting.
