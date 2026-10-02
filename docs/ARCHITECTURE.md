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
                     │ transaction log/undo · moderation hooks · core UI (menu, mute, report, safe mode)                   │
                     └────────────────────────────────────────────────────────────────────────────────────────────────────┘
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
  can always mute, leave, report and roll back.

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
- **fork/patch** other modules (permission permitting, see §6),
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
- Draw over or replace the **core UI**: escape menu, mute/report/leave, the
  "safe mode" key, chat moderation, and the "which module made this?" inspector.
- Read other players' private data (accounts, IPs, DMs) or other modules' state
  outside their declared capabilities.
- Change the kernel.

---

## 4. The agent loop: from "make it rain frogs" to live code

Each player gets their own agent session (server-side, e.g. built on the Claude
Agent SDK). Its tools are scoped to that player:

| Tool | What it does |
|---|---|
| `read_api_docs`, `list_modules`, `read_module` | Learn the engine API and read the world's current source, so it can build on what others made |
| `inspect_world` | Query entities/components/blocks near the player |
| `write_module` / `patch_module` | Edit files in the player's **branch** of the world's code |
| `typecheck`, `lint`, `run_tests` | Fast static checks against the module API types |
| `dry_run` | Run the branch on a **shadow fork** of the live world (a copy of the affected chunks + entities) for N ticks; returns errors, budget usage, screenshots, perf numbers |
| `preview` | Enable the change **only for the requesting player** (personal layer) so they can see/feel it in the live world |
| `publish` | Submit to the world: passes the gates below, then hot-loads for everyone |

Publish pipeline:

```
agent branch
  → typecheck + lint + capability check (does the code only touch what the manifest declares?)
  → automated review (second model reads the diff: malicious intent, disguised network use,
     harassment content, obvious perf bombs, attempts to mimic core UI)
  → shadow dry run: no crashes, within CPU/memory/bandwidth/GPU budgets
  → content moderation on any text/images/sounds/models it adds
  → world policy: auto-publish | host approval | player vote (configurable per world)
  → canary: live for the author + opted-in players for ~30–60 s, watch errors/perf
  → live for everyone (one commit; one-click revert)
```

In the 30-player event format, most worlds would probably run **auto-publish
with canary** so it feels instant, plus host override.

**Prompt injection:** agents read code, signs and chat written by *other*
players. Treat all of it as untrusted data. An agent can only act on behalf of
its own player, with that player's permissions, so an injected instruction can't
do more than the victim's agent was already allowed to do, and every publish
still goes through the same gates.

---

## 5. Many agents editing one world at the same time

- **Branch per player, merge into live.** Agents work on branches; publishing
  is a merge. Non-overlapping changes (new modules) merge freely. Patches to the
  same module are rebased; real conflicts go back to the agent to resolve.
- **Ownership & permissions per module:** `owner` (author), `editors`,
  `forkable`. Default: anyone can *fork* a module (copy and change it), only
  owners/editors can *patch* it in place. Hosts can patch anything.
- **Engine-level slots** (physics, movement, mesher, lighting, camera) have
  exactly one active implementation per world (or per region). Replacing one
  needs host approval or a vote, because it changes the game for everyone.
- **Scoping:** modules can be global or limited to a region/dimension/game mode,
  so ten people can each run their own mini-game in different arenas without
  stepping on each other.
- **Ordering:** systems declare phases (`input → simulate → physics → rules →
  post`) and optional `before/after` constraints; the kernel builds the schedule.
- **Global caps** (total CPU per tick, total entities, total bandwidth per
  client) are split fairly across active authors, so one module can't lag the
  world.

---

## 6. Recommended stack

| Layer | Pick | Why |
|---|---|---|
| Module language | **TypeScript** | What LLM agents write best; the same code runs on server and client |
| Rendering | Three.js `WebGPURenderer` (WebGL2 fallback) + **TSL** node materials | Agents can write shaders in TS and the engine can still validate/compile them; WebGPU on Safari is still uneven, so keep the fallback working |
| Voxels | 32³ chunks, greedy meshing in workers (default mesher is itself a replaceable module) | |
| Server kernel | **TypeScript on Node/Bun** with **V8 isolates** (`isolated-vm` / workerd) in a separate process pool; Rust for hot kernel paths later | Fast enough for per-tick logic, with real memory/CPU limits |
| Client sandbox | Cross-origin sandboxed iframe + Web Worker + SES lockdown, typed message API to the renderer | Others' code never touches your DOM, cookies or network |
| Netcode | Authoritative server, 20–30 Hz, prediction + reconciliation, interpolation, area-of-interest per chunk; WebSocket first, WebTransport later | Component schemas from module manifests drive binary serialization + deltas |
| Code store | Content-addressed module tree per world (git-like), commits = publishes | Instant revert, diffs for review, "who wrote this" |
| State store | Postgres (accounts, worlds, commits, audit), chunk/ECS snapshots in S3/R2 + append-only transaction log, Redis for presence/rate limits | Point-in-time rollback of state *and* code |
| Agents | One agent session per player, e.g. Claude Agent SDK, with the tools in §4; a cheaper model as diff reviewer/classifier | Cost caps per player and per world |
| Alternatives | SpacetimeDB (server logic as modules inside the DB, streamed state, has Three.js starters), Colyseus (TS rooms) | Look at SpacetimeDB seriously: its "modules that hot-publish into a live DB" model is close to this design |

---

## 7. Safeguards checklist

**Kernel and sandbox**
- [ ] Server isolates in a separate, unprivileged, egress-blocked process pool
- [ ] Hard CPU/memory/entity/bandwidth budgets; auto-suspend + notify author
- [ ] Capabilities declared in the manifest and enforced at the API boundary
- [ ] Client modules: cross-origin sandboxed iframe + worker, no network/DOM/storage, strict CSP
- [ ] Shader validation, compile timeouts, frame-time watchdog, device-loss recovery

**Content and behavior**
- [ ] No external URLs/media in modules; every asset goes through upload → moderation → CDN
- [ ] Moderate text, images, audio and models added by modules; second-model review of diffs
- [ ] Core UI can't be covered or imitated; a "which module did this?" inspector on any entity, sound or effect
- [ ] Per-player controls: mute a module/author for yourself, **safe mode** (vanilla modules only), report
- [ ] Host/mod tools: freeze all publishing, revert a commit, revert everything by author X, kick/ban

**Recovery and accountability**
- [ ] Every publish is a commit; every state change is in the transaction log
- [ ] One-click revert of code *and* the state changes it caused
- [ ] Audit trail: player → agent prompt → diff → commit → effects
- [ ] Automatic revert if error rate, tick time or client FPS crosses thresholds after a publish

**Platform**
- [ ] Short-lived auth tokens on the socket; rate limits on every message and every agent tool
- [ ] AI spend caps per player/world; cache identical generations
- [ ] If minors can join: age gating, restricted chat, legal review (COPPA/GDPR-K, DSA)
- [ ] Load test with bot clients *and* bot agents publishing hostile modules (red-team the sandbox)

---

## 8. Build order

| Phase | Outcome | Rough effort (1–3 devs, AI-assisted) |
|---|---|---|
| 0. Engine as modules | Single-player voxel world where movement, blocks, gravity and meshing are already modules loaded by a minimal kernel; hot reload with state kept | 2–3 weeks |
| 1. Multiplayer kernel | Authoritative server, 30 players, schema-driven netcode, persistence, transaction log + undo | 3–4 weeks |
| 2. Sandboxes | Server V8 isolates with budgets/capabilities; client sandboxed worker + message API; shader validation + watchdog | 3–5 weeks |
| 3. Agents | Per-player agent with read/write/dry-run/preview/publish tools; shadow forks; canary; auto-revert | 3–4 weeks |
| 4. Collaboration & safety UX | Branches/merging, ownership, votes/host approval, inspector, mute/safe mode, moderation pipeline | 2–4 weeks |
| 5. Scale & polish | WebTransport, crowds via instancing, red-team the sandbox, 100+ player load tests | ongoing |

The key early decision is in Phase 0: **make the built-in game itself out of
modules from day one.** If the engine's own features use the same API the
agents use, then "change the engine" works automatically. If they don't, the
agents will always be limited to a smaller box than the engine developers.

---

## 9. Open decisions

1. **V8 isolates vs SpacetimeDB modules vs QuickJS** for server logic: speed vs
   built-in persistence vs simplicity.
2. **Default publish policy:** auto + canary (fast, chaotic, fun) vs host
   approval (safer, slower). Probably per world.
3. **How deep can agents go?** Replacing physics/netcode prediction is powerful
   but can break the game for everyone; it could be limited to engine "slots"
   with a vote.
4. **Session worlds vs persistent worlds.** Session events (like the 30-person
   tests) are much easier to run and moderate; start there.

## References

- Spawn / @jsnnsa: https://x.com/jsnnsa/status/2064420561078693941, https://x.com/jsnnsa/status/2021763028845572204
- SpacetimeDB + Three.js: https://discourse.threejs.org/t/spacetimedb-threejs-support-and-free-tier/90052
- Three.js + SpacetimeDB multiplayer starter: https://github.com/majidmanzarpour/vibe-coding-starter-pack-3d-multiplayer
- Multiplayer voxel browser engine write-up: https://kevzettler.com/2023/04/25/multiplayer-voxel-game-engine/
- QuickJS WebAssembly sandbox (and its warning to add process isolation in production): https://sebastianwessel.de/projects/quickjs-sandbox/
- Why language sandboxes alone aren't a security boundary: https://www.pandastack.ai/blog/microvm-game-mod-execution-isolation/
