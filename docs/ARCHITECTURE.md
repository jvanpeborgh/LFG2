# LFG2 — A Live, Agent-Editable Browser Voxel World

Goal: a Minecraft-like world that runs in the browser, where every player directs
their own AI agent to **write new code into the running world**: new game logic,
new mechanics and rules, new shaders, even replacements for engine subsystems.
Everyone keeps playing while it happens.

There is no fixed catalogue of objects or rules. The only fixed thing is a small
trusted **kernel**. Everything else, including the "default game", is code the
agents can read, fork, change or replace.

Reference point: Jacob (@jsnnsa) / Spawn's live test: "30 players each directing
their own AI agent to write new game logic, shaders, change the engine, create
mechanics etc into the same running world while everyone keeps playing." A reply
in the same thread ("I joined this and someone rickrolled…") shows why the safety
side is half the product.

---

## 1. Core principle: a tiny trusted kernel, everything else is hot-swappable code

```
                     ┌──────────────────────── TRUSTED KERNEL (we write it, agents can't change it) ───────────────────────┐
                     │ auth · networking · persistence · module loader · sandboxes · budgets · permissions ·               │
                     │ transaction log/undo · moderation hooks · core UI (menu, mute, report, leave)                       │
                     └─────────────────────────────────────────────────────────────────────────────────────────────────────┘
                                  ▲ hosts                                   ▲ hosts
        ┌─────────────────────────┴───────────────────┐       ┌────────────┴──────────────────────────────┐
        │ SERVER MODULES (authoritative)              │       │ CLIENT MODULES (presentation + prediction)│
        │ e.g. physics, block types, crafting,        │       │ e.g. shaders/materials, particles, post-  │
        │ "floor is lava", dragon AI, game modes,     │       │ FX, HUD widgets, camera, input mapping,   │
        │ weather, economy, mesher, …                 │       │ predicted movement, sounds, …             │
        └─────────────────────────────────────────────┘       └───────────────────────────────────────────┘
                 ▲ written / edited by                                   ▲ written / edited by
        ┌────────┴───────────────────────────────────────────────────────┴──────────┐
        │ PLAYER AGENTS (one per player) — read the world's source + API docs,      │
        │ write code, test it on a shadow copy, publish it as a change to the world  │
        └───────────────────────────────────────────────────────────────────────────┘
```

- **World state** = chunks + ECS entities/components, owned by the server.
- **World code** = a versioned tree of modules (like a git repo per world). Each
  publish is a commit. The running world = current state + current code commit.
- The **default game** (walking, blocks, gravity, day/night) ships as ordinary
  modules, so agents can change "how jumping works" in the same way they add a
  dragon.
- The kernel only guarantees: nobody escapes their sandbox, nobody takes the
  server or other players' machines down, everything can be undone, and players
  can always leave, report abuse, and the world can always be rolled back.

---

## 2. What a module is

A module is a folder of TypeScript (plus optional WGSL/TSL shaders and assets)
with a manifest:

```ts
// modules/lava-floor/manifest.ts
export default defineModule({
  id: "lava-floor",
  author: "player:alice",
  // components this module defines; schema is used for networking, storage, migrations
  components: {
    LavaTimer: { secondsLeft: "f32" },
  },
  // explicit capabilities: what it may read/write. Enforced by the kernel.
  capabilities: {
    readComponents: ["Position", "Player", "LavaTimer"],
    writeComponents: ["LavaTimer", "Health"],
    setBlocks: { region: "arena-1", maxPerSecond: 500 },
    spawn: { maxEntities: 50 },
  },
  server: "./server.ts",   // runs in a server isolate (authoritative)
  client: "./client.ts",   // runs in a sandboxed worker in every browser (visuals/prediction)
  shaders: ["./lava.tsl.ts"],
});
```

```ts
// modules/lava-floor/server.ts
export default system({ every: "1s" }, (world) => {
  for (const [e, timer] of world.query(LavaTimer)) {
    timer.secondsLeft -= 1;
    if (timer.secondsLeft <= 0) world.fillBlocks("arena-1", { y: 10 }, "lava");
  }
});
```

Agents can:
- **add** modules (new mechanics, rules, game modes, creatures, items),
- **fork/patch** other modules (permission permitting, see §8),
- **replace engine-level modules** behind a stable interface (physics step,
  mesher, lighting pass, camera, input, movement controller),
- **write shaders** (materials, post-processing, sky, weather),
- **define new components and block types**, which is how they invent new
  *kinds* of rules, not just new instances of old ones.

Because state lives in ECS components and code lives in modules, code can be
**hot-reloaded without losing state**: swap the system functions, keep the
component data. Schema changes ship with a migration function the kernel runs
once.

---

## 3. Running untrusted code safely

This is the hard part. Code that 30 different agents wrote runs on the server
**and** on every player's browser.

### Server side (authoritative logic)

- **V8 isolates** (the approach behind Cloudflare Workers; in Node via
  `isolated-vm`, or `workerd`/Deno), one isolate per module or per author. V8 is
  JIT-compiled, so per-tick game logic is fast enough. QuickJS-wasm is a simpler
  but slower fallback.
- Isolates run in a **separate low-privilege process pool**: no secrets, no
  filesystem, **no network egress**, seccomp/container limits. Assume an isolate
  escape is possible and make it boring.
- **Budgets per tick:** CPU time (e.g. 1–2 ms per module per tick, hard
  terminate on overrun), memory cap, entities spawned, blocks changed, network
  bytes generated, timers. Over-budget modules are **suspended automatically**
  and their author's agent is told why.
- **Capability-scoped world API:** a module only sees the components and regions
  in its manifest. All writes go through the kernel's transaction log, so they're
  attributable and undoable.

### Client side (visuals, UI, prediction)

Other players' code running in *your* browser is the riskiest part.

- Client modules run in a **Web Worker inside a cross-origin sandboxed iframe**
  (separate origin from the game and the auth cookies), with **no DOM, no
  `fetch`, no WebSocket, no storage**, and a strict CSP. Hardened JS (SES
  `lockdown()`) inside the worker adds a second layer.
- They talk to the renderer only through a **typed message API**: "spawn
  particle emitter with these params", "set material uniform", "draw HUD widget
  in my allotted box". The kernel owns the real Three.js scene and the canvas.
- **Shaders** are written in Three.js TSL or WGSL, then **validated and compiled
  by the kernel** (naga/tint validation, loop-bound checks, instruction-count
  cap). The GPU is already sandboxed by the browser; the real risk is a shader
  that hangs the GPU or tanks FPS. So:
  - compile off the main thread and reject on timeout,
  - measure frame cost when it's enabled; **auto-disable on frame time spikes or
    WebGPU device loss**, and recover the device,
  - per-player graphics budget (draw calls, lights, particles, post-FX passes).
- **Prediction code** (e.g. a new movement mechanic) is the same module code
  running in the client sandbox and the server isolate; the server stays
  authoritative and corrects the client if they disagree.

### Things module code can never do

- Make network requests or embed external URLs (no surprise videos, no IP
  grabbing, no rickrolls). All media must go through the **asset pipeline**
  (upload → moderation → content-addressed CDN).
- Draw over or replace the **core UI**: escape menu, mute/report/leave, chat
  moderation, and the "which change made this?" inspector.
- Read other players' private data (accounts, IPs, DMs) or other modules' state
  outside their declared capabilities.
- Change the kernel.

---

## 4. The agent loop: from "make it rain frogs" to live code

Each player gets their own agent session (server-side, e.g. built on the Claude
Agent SDK). Its tools are scoped to that player:

| Tool | What it does |
|---|---|
| `read_standards` | Read the world bible (`docs/standards/`): style, audio, balance, fun and comfort rules, with the world's *current* values |
| `read_api_docs`, `list_modules`, `read_module` | Learn the engine API and read the world's current source, so it can build on what others made |
| `inspect_world` | Query entities/components/blocks near the player |
| `write_module` / `patch_module` | Edit files in the player's **branch** of the world's code |
| `typecheck`, `lint`, `run_tests` | Fast static checks against the module API types |
| `dry_run` | Run the branch on a **shadow fork** of the live world for N ticks; returns errors, budget usage, screenshots, perf numbers. Only the agent sees this; players never review anything |
| `cast` | Submit the change. It goes through the automatic checks in §5 and then lands for **everyone** as a world event |

There is **no human review step, no vote and no personal preview**. Players
play; their agents build. Every check is automatic and happens in the
background in seconds. The players' only experience of a change is the world
event when it arrives.

**Prompt injection:** agents read code, signs and chat written by *other*
players. Treat all of it as untrusted data. An agent can only act on behalf of
its own player, with that player's permissions, so an injected instruction can't
do more than the victim's agent was already allowed to do, and every cast still
goes through the same automatic checks.

---

## 5. Changes arrive as world events

Every change lands for all players at the same moment, as something that
*happens in the world*, not as a patch.

```
 agent casts change
   │
   ▼
 ① GATHERING (invisible gates, ~5–30 s)          what players see
   typecheck · capability check · AI diff review   ─▶ sky darkens / rift opens / runes glow
   moderation of added text, images, sounds         at the spot (or over the whole map),
   shadow run on a fork with replayed real inputs   "Alice's agent is summoning something…"
   headless-browser render test (FPS, shaders)
   standards check + bot playtest "fun report"
   │ fail → event FIZZLES ("the spell collapsed"), agent gets the error report, nothing changes
   ▼
 ② PRELOAD (2–10 s, overlaps the build-up)
   server loads the new code into a fresh isolate next to the old one
   clients download + compile code and shaders in the background, then send "ready"
   │ clients that aren't ready in time keep playing and catch up a moment later
   ▼
 ③ ARRIVAL (one tick, everyone at once)
   at tick T the kernel swaps old → new between ticks; clients switch on the same tick
   effect plays: thunder, portal burst, banner "⚡ LAVA RAIN — by Alice"
   │
   ▼
 ④ AFTERSHOCK WATCH (first ~60 s live)
   kernel watches errors, tick time, client FPS, crash reports
   │ bad → automatic UNDO, shown as a world event too ("time rewinds…"), state restored
   ▼
 now part of the world (until another change replaces or undoes it)
```

Rules for the event queue:

- **One big event at a time.** Changes queue and arrive one after another
  (e.g. at least 20–60 s apart, configurable per world). That makes each one a
  moment people notice, and if something goes wrong it's obvious which change
  did it.
- **Small changes can batch.** Tweaks to an existing module ("make the dragon
  faster") can arrive as a minor event or ride along with the next big one.
- **The cost of waiting is hidden by the build-up.** The checks take seconds;
  the "gathering" visuals fill that time so it feels like drama, not loading.
- **Failure is part of the show.** A change that fails the checks fizzles in
  the world, and a change that goes wrong after arriving is visibly undone.
  Neither crashes anything.
- **Engine-level changes** (physics, movement, lighting) are bigger events
  with a longer build-up and a countdown, since they change how everyone plays.

Players can't opt out of gameplay changes, because the world is shared. The one
exception is safety: anyone can still mute or report abusive content
(harassing text, offensive images, loud or disturbing audio) for themselves,
and that triggers moderation for everyone.

---

## 6. Preventing crashes during play

Goal: **nothing an agent writes can crash the server, crash a player's browser,
or freeze the game.** A broken change should, at worst, fizzle or be undone.
This needs several layers, because each one will miss some things.

### Layer 1 — Catch it before it arrives (the "gathering" phase)

- **Static checks:** TypeScript typecheck against the module API, capability
  check, banned-pattern lint (unbounded loops without yields, huge allocations).
- **Shadow run with real inputs:** run the new code on a fork of the live world
  with the **last ~60 s of real player inputs replayed**, sped up. Also run a
  few fuzzed inputs (random players spamming actions, edge positions, empty
  world). Must finish with no exceptions, within budgets, and pass the
  invariants in Layer 3.
- **Render test:** load the client part and shaders in a headless browser on
  a low-end GPU profile; reject on shader compile failure, GPU device loss or
  frame time over budget.
- **Dependency check:** if the change modifies a module others build on, re-run
  those modules' tests and shadow checks too.
- **Schema migrations** run on the fork first and must pass invariants.
- **Standards check:** asset budgets, loudness, photosensitivity/comfort limits
  and "no player stuck / no control taken > 3 s" are hard rules; style and
  balance rules produce a report for the agent (see
  [`docs/standards/`](standards/README.md)).

### Layer 2 — Swap safely

- **Swap only between ticks**, never in the middle of one. The new isolate is
  already loaded and warmed up; the swap is a pointer change.
- **Clients preload before arrival**: code and shaders are compiled before tick
  T, so nobody stutters when it lands.
- **Old version stays in memory** for the aftershock window, so undo is instant.

### Layer 3 — Contain failures while running

- **Each module's systems run inside a transaction per tick.** If one throws,
  its changes from that tick are thrown away, the rest of the world carries on,
  and the module's error count goes up. Too many errors → automatic undo.
- **Watchdog on every isolate:** hard timeout per call (e.g. 2–5 ms); the
  isolate is killed and the module paused, the tick continues without it.
- **Isolates live in separate processes** from the kernel, so a crash, memory
  blow-up or infinite loop in agent code kills a worker process, not the world.
- **The kernel validates every write:** types, ranges, no NaN/Infinity, entity
  and block limits. Bad data never reaches world state or other clients.
- **World invariants checked every tick:** players have finite positions, are
  not stuck inside solid blocks, entity/particle counts under caps, tick time
  under budget, every player can still move and open the menu. A broken
  invariant rolls back that tick and blames the module that caused it.
- **Dead-man's switch for the game itself:** walking, the menu and leaving are
  kernel features with a fallback, so even if an agent replaces the movement
  module with something broken, players aren't trapped.

### Layer 4 — Protect each player's browser

- **Agent code runs in a separate worker** (the sandbox in §3); if it throws,
  hangs or eats memory, the kernel kills and restarts that worker and keeps
  rendering. Your game never runs agent code on the main thread.
- **Render budgets enforced by the kernel**: max draw calls, lights,
  particles, texture memory per module. Requests over budget are clipped, not
  passed to the GPU.
- **GPU watchdog:** if frame time spikes after an event or the WebGPU device is
  lost, the client recreates the device, turns off the newest shaders/effects
  and reports it.
- **Server listens to the crowd:** if more than a small share of clients report
  problems with a change, it's undone for everyone automatically.
- **Low-end fallback:** each module can declare a cheaper visual version; weak
  devices get that instead of dropping frames.

### Layer 5 — Recover if the server does go down anyway

- **Snapshots every few seconds + the transaction log**, so a restart loses at
  most the last moments.
- **Fast restart (seconds):** a supervisor restarts the world process; clients
  reconnect automatically and keep their view on screen while it happens.
- **Crash-loop protection:** if the world crashes again soon after restart, it
  boots with the **most recent change(s) left out** (last-known-good code), and
  the culprit is undone and reported back to its agent.
- Optional later: a hot standby process that follows the transaction log and
  takes over instantly.

### Layer 6 — Learn from it

- Every fizzle, undo and crash is recorded with the change that caused it and
  sent back to the agent that wrote it, so it can fix the change and cast again.
- Common failure patterns become new static checks, so the same mistake is
  caught earlier next time.

---

## 7. Shared standards (the world bible)

So 30 agents build one coherent, fun game instead of 30 clashing ones, every
agent reads and builds on a shared set of standards in
[`docs/standards/`](standards/README.md):

- **Art & 3D assets:** default "Chunky Daylight" voxel style, 48-colour palette
  with reserved meanings (danger, heal, interact…), units and scale, how to
  generate models (procedural code first), polygon budgets, rig and animation
  names, lighting, shaders, VFX.
- **Audio & music:** default key/tempo/instruments, adaptive music stems driven
  by game intensity, SFX rules, spatial audio, loudness limits, licensing.
- **Game design & fun:** fun principles, a pacing **director** that the event
  queue consults (tension → peak → relief), baseline balance numbers, power
  creep limits, economy rules, game-mode structure, anti-griefing rules, and an
  automatic bot-playtest "fun report".
- **UX, accessibility & comfort:** screen zones, text, accessibility settings,
  photosensitivity and motion-comfort limits.
- **`defaults.json`:** the same values in machine-readable form. Modules import
  them (`@world/standards`) instead of hard-coding numbers, so changing a
  standard updates existing content too.

Rules come in three tiers: 🔒 **locked** (health, safety and performance, kernel
enforced), 🌍 **world defaults** (changeable for everyone through an *epic* world
event, e.g. "The Neon Age begins"), and 📍 **local overrides** inside one
module's area or game mode.

---

## 8. Many agents editing one world at the same time

- **Branch per player, merge into live.** Agents work on branches; casting
  merges into the event queue. Non-overlapping changes (new modules) merge
  freely. Patches to the same module are rebased; real conflicts go back to the
  agent to resolve.
- **Ownership per module:** anyone can *fork* a module (copy and change it);
  only its author can *patch* it in place. Hosts can patch anything.
- **Engine-level slots** (physics, movement, mesher, lighting, camera) have
  exactly one active implementation per world (or per region); replacing one is
  a big world event (see §5).
- **Scoping:** modules can be global or limited to a region/dimension/game mode,
  so ten people can each run their own mini-game in different arenas without
  stepping on each other.
- **Ordering:** systems declare phases (`input → simulate → physics → rules →
  post`) and optional `before/after` constraints; the kernel builds the schedule.
- **Global caps** (total CPU per tick, total entities, total bandwidth per
  client) are split fairly across active authors, so one module can't lag the
  world.

---

## 9. Recommended stack

| Layer | Pick | Why |
|---|---|---|
| Module language | **TypeScript** | What LLM agents write best; the same code runs on server and client |
| Rendering | Three.js `WebGPURenderer` (WebGL2 fallback) + **TSL** node materials | Agents can write shaders in TS and the engine can still validate/compile them; WebGPU on Safari is still uneven, so keep the fallback working |
| Voxels | 32³ chunks, greedy meshing in workers (default mesher is itself a replaceable module) | |
| Server kernel | **TypeScript on Node/Bun** with **V8 isolates** (`isolated-vm` / workerd) in a separate process pool; Rust for hot kernel paths later | Fast enough for per-tick logic, with real memory/CPU limits |
| Client sandbox | Cross-origin sandboxed iframe + Web Worker + SES lockdown, typed message API to the renderer | Others' code never touches your DOM, cookies or network |
| Netcode | Authoritative server, 20–30 Hz, prediction + reconciliation, interpolation, area-of-interest per chunk; WebSocket first, WebTransport later | Component schemas from module manifests drive binary serialization + deltas |
| Code store | Content-addressed module tree per world (git-like), commits = world events | Instant undo, diffs for the AI reviewer, "who wrote this" |
| State store | Postgres (accounts, worlds, commits, audit), chunk/ECS snapshots in S3/R2 + append-only transaction log, Redis for presence/rate limits | Point-in-time rollback of state *and* code |
| Process supervision | Supervisor per world process (systemd/Kubernetes/Fly Machines) with fast restart and last-known-good boot | Layer 5 of §6 |
| Gate runners | Pool of workers for shadow runs + headless Chromium for render tests | Keeps the "gathering" phase to seconds |
| Agents | One agent session per player, e.g. Claude Agent SDK, with the tools in §4; a cheaper model as diff reviewer/classifier | Cost caps per player and per world |
| Alternatives | SpacetimeDB (server logic as modules inside the DB, streamed state, has Three.js starters), Colyseus (TS rooms) | Look at SpacetimeDB seriously: its "modules that hot-publish into a live DB" model is close to this design |

---

## 10. Safeguards checklist

**Kernel and sandbox**
- [ ] Server isolates in a separate, unprivileged, egress-blocked process pool
- [ ] Hard CPU/memory/entity/bandwidth budgets; auto-pause + notify the author's agent
- [ ] Capabilities declared in the manifest and enforced at the API boundary
- [ ] Client modules: cross-origin sandboxed iframe + worker, no network/DOM/storage, strict CSP
- [ ] Shader validation, compile timeouts, frame-time watchdog, device-loss recovery

**Crash prevention (see §6)**
- [ ] Shadow run with replayed real inputs + fuzzing + headless render test before every event
- [ ] Swap only between ticks; clients preload before arrival
- [ ] Per-module transaction per tick; per-call watchdog; kernel validates every write
- [ ] World invariants every tick; kernel-owned fallback for movement and menu
- [ ] Aftershock watch → automatic undo; crowd crash reports → automatic undo
- [ ] Snapshots + log, fast restart, crash-loop protection with last-known-good code

**Content and behavior**
- [ ] No external URLs/media in modules; every asset goes through upload → moderation → CDN
- [ ] Moderate text, images, audio and models added by modules; second-model review of diffs
- [ ] Core UI can't be covered or imitated; a "which change did this?" inspector on any entity, sound or effect
- [ ] Mute/report abusive content for yourself (safety only, not gameplay)
- [ ] Host emergency tools: pause the event queue, undo any event, undo everything by author X, kick/ban

**Recovery and accountability**
- [ ] Every world event is a commit; every state change is in the transaction log
- [ ] One-click undo of code *and* the state changes it caused
- [ ] Audit trail: player → agent prompt → diff → event → effects

**Platform**
- [ ] Short-lived auth tokens on the socket; rate limits on every message and every agent tool
- [ ] AI spend caps per player/world; cache identical generations
- [ ] If minors can join: age gating, restricted chat, legal review (COPPA/GDPR-K, DSA)
- [ ] Load test with bot clients *and* bot agents casting hostile or broken changes (red-team the sandbox and the crash layers)

---

## 11. Build order

| Phase | Outcome | Rough effort (1–3 devs, AI-assisted) |
|---|---|---|
| 0. Engine as modules | Single-player voxel world where movement, blocks, gravity and meshing are already modules loaded by a minimal kernel; hot swap between ticks with state kept | 2–3 weeks |
| 1. Multiplayer kernel | Authoritative server, 30 players, schema-driven netcode, snapshots + transaction log + undo, supervisor with fast restart | 3–4 weeks |
| 2. Sandboxes & containment | Server V8 isolates with budgets, watchdogs, per-tick transactions and invariants; client sandboxed worker + message API; shader validation + GPU watchdog | 3–5 weeks |
| 3. World events | Event queue, gathering/preload/arrival/aftershock phases, shadow runs with replayed inputs, headless render tests, automatic undo, event visuals | 3–4 weeks |
| 4. Agents & standards | Per-player agent with read/write/dry-run/cast tools; AI diff review; world bible + `@world/standards`; director; standards checks and bot fun report; failure reports fed back to agents | 3–5 weeks |
| 5. Scale & polish | WebTransport, crowds via instancing, red-team the sandbox, 100+ player load tests | ongoing |

**Status:** Phase 0 and Phase 1 are built (see the README): the base game runs as
modules on a kernel, with multiplayer (load-tested with 30 bot players: ~8 ms
per server tick, ~11 ms peak while terrain loads, against a 50 ms budget),
persistence, and per-change block tracking. From Phase 2, the kernel's error containment (a failing
module is switched off and announced) is in; sandboxed execution is not yet. From Phase 3, the
world-event pipeline is in: rule changes and module files gather (with a shadow run that reads the
real world and discards writes), arrive in one tick for everyone, and are undone automatically if
a module breaks, the server slows down, or many players die during the aftershock.

The key early decision is in Phase 0: **make the built-in game itself out of
modules from day one.** If the engine's own features use the same API the
agents use, then "change the engine" works automatically. If they don't, the
agents will always be limited to a smaller box than the engine developers.

---

## 12. Open decisions

1. **V8 isolates vs SpacetimeDB modules vs QuickJS** for server logic: speed vs
   built-in persistence vs simplicity.
2. **Event pacing:** how far apart events arrive (more chaos vs more
   readable), and whether small tweaks batch.
3. **How deep can agents go?** Replacing physics/netcode prediction is powerful
   and risky; it could be limited to engine "slots" with longer build-ups.
4. **How strict the standards are:** which style/balance rules should be
   hard (fizzle) vs soft (report only). Start soft and harden what keeps
   breaking the fun.
5. **Session worlds vs persistent worlds.** Session events (like the 30-person
   tests) are much easier to run and moderate; start there.

## References

- Spawn / @jsnnsa: https://x.com/jsnnsa/status/2064420561078693941, https://x.com/jsnnsa/status/2021763028845572204
- SpacetimeDB + Three.js: https://discourse.threejs.org/t/spacetimedb-threejs-support-and-free-tier/90052
- Three.js + SpacetimeDB multiplayer starter: https://github.com/majidmanzarpour/vibe-coding-starter-pack-3d-multiplayer
- Multiplayer voxel browser engine write-up: https://kevzettler.com/2023/04/25/multiplayer-voxel-game-engine/
- QuickJS WebAssembly sandbox (and its warning to add process isolation in production): https://sebastianwessel.de/projects/quickjs-sandbox/
- Why language sandboxes alone aren't a security boundary: https://www.pandastack.ai/blog/microvm-game-mod-execution-isolation/
