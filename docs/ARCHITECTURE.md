# LFG2 — Browser Voxel Sandbox with Live, Player-Authored Scenarios

Goal: a Minecraft-like world that runs in the browser, where many players share
one world **and** can summon things, create scenarios and add rules on top of it
while it is running (by hand or by asking an AI), without anyone being able to
break the world, the server, or each other.

Reference point: Jacob (@jsnnsa) / Spawn's live test of ~30 people building a
game world together while playing in it (Jan 2026). Spawn uses Three.js +
WebGPU with its own physics and lighting, and shows the idea works in a browser.

---

## 1. The core idea: the world is data, everything else changes that data

The world is a set of rows: chunks, entities, components, rules.
Everything that changes the world is a **transaction** against those rows,
whether it comes from a player placing a block, a scenario script ticking, or an
AI "summon". One authoritative server owns the rows. Clients only render them
and send *intents*.

That one decision gives you:

- **Safety** — untrusted content never runs on other players' machines; it only
  produces data the server validates.
- **Undo/rollback** — every transaction is logged, so it can be reverted.
- **Fairness** — the server decides outcomes, which limits cheating.
- **Live editing** — a new rule is just a new row, so it can be hot-loaded.

```
 Browser client                 World server (authoritative, one per shard)          Platform services
 ┌──────────────────┐  intents  ┌────────────────────────────────────────────┐    ┌─────────────────────┐
 │ Renderer (Three/ │ ────────▶ │ Tick loop (20–30 Hz)                       │    │ Auth / accounts     │
 │  WebGPU→WebGL2)  │           │  ├ Voxel store (chunks)                    │    │ Postgres (metadata) │
 │ Meshing workers  │ ◀──────── │  ├ ECS (entities/components)               │◀──▶│ Object store        │
 │ Prediction +     │  deltas   │  ├ Physics                                 │    │  (chunk snapshots)  │
 │  interpolation   │ (binary)  │  ├ Rule engine (declarative DSL)           │    │ Event log           │
 │ UI / chat /      │           │  ├ Script sandbox pool (QuickJS/Luau wasm) │    │ AI gateway          │
 │  "summon" prompt │           │  ├ Interest mgmt (who sees what)           │    │  (LLM + moderation) │
 └──────────────────┘           │  └ Transaction log + undo                  │    │ Asset pipeline      │
                                └────────────────────────────────────────────┘    └─────────────────────┘
```

---

## 2. Recommended stack (and why)

| Layer | Pick | Alternatives / notes |
|---|---|---|
| Rendering | **Three.js** with `WebGPURenderer` (falls back to WebGL2 automatically) | Babylon.js (also strong WebGPU), Bevy→wasm (Rust-only team). Safari WebGPU support is still uneven, so keep the WebGL2 path working. |
| Voxel meshing | Chunks of 32³, **greedy meshing in Web Workers** (or a Rust→wasm mesher), texture array atlas, ambient occlusion baked into vertices | noa-engine for a quick prototype |
| Crowds / NPCs | GPU instancing + baked/vertex animation; LOD to impostors far away | needed for "hundreds of characters" scenes like the video |
| Client physics | Simple voxel AABB sweep for the player (fast, deterministic); Rapier (wasm) only for dynamic props | Same code on server for prediction |
| Transport | **WebSocket** (binary) to start; **WebTransport** (unreliable datagrams) for movement later | WebRTC data channels are another option but are more complex to run |
| Netcode model | Authoritative server; client-side prediction + reconciliation for your own avatar; snapshot interpolation (~100 ms) for others; chunk-based area of interest | Don't use lockstep — it can't cope with hot-loaded rules and dropping players |
| Wire format | Hand-packed binary or FlatBuffers/MessagePack; delta compression per entity per client | JSON is fine for the first prototype only |
| Server runtime | **TypeScript on Bun/Node** to share code with the client, *or* **Rust** for heavy sims | **Colyseus** (TS rooms + state sync) is a fast start; **SpacetimeDB** (logic in the DB, state streamed to clients, has Three.js starters) is strong if you accept its model |
| Persistence | Postgres (accounts, worlds, scenarios, audit); chunk snapshots in S3/R2 + append-only event log; Redis for presence/rate limits | |
| Script sandbox | **QuickJS compiled to wasm** (JS/TS) or **Luau** (Roblox's sandboxed Lua) in worker threads/processes with fuel, memory and time limits | Firecracker microVMs if you ever allow arbitrary native code (don't, at first) |
| AI | LLM behind an internal **AI gateway** using tool calls that output DSL/scripts, *not* free-form code execution | Small/cheap model for classification and validation, big model for generation |

**Default recommendation for a small team:** TypeScript everywhere (shared
`@lfg/sim` package used by client and server), Three.js WebGPU, Colyseus or a
thin custom WebSocket server on Bun, Postgres + R2, QuickJS-wasm sandbox.
Move hot paths (meshing, physics) to Rust→wasm only when profiling says so.

---

## 3. Scaling the world

- **Shard per world instance.** One process owns one world (or one region of a
  big world). Aim for 50–150 concurrent players per shard; that's already more
  than the 30-person test.
- **Interest management.** Each client subscribes to the chunks within view
  distance, and only gets entity deltas for those chunks. This is the single
  biggest bandwidth lever.
- **Budgets per tick.** Fixed CPU budget per tick split between physics, rules,
  and scripts. If scripts exceed their share they get throttled, not the world.
- **Bigger worlds later.** Split space into regions owned by different
  processes with hand-off at borders (SpatialOS-style). Only worth doing once a
  single shard is the bottleneck.
- **Persistence.** Dirty chunks flush every N seconds; snapshot + event log
  lets you restore any point in time ("rewind the last 10 minutes").

---

## 4. The "summon / scenario / rules" layer

This is the product. Design it as **three tiers of power**, each more powerful
and more restricted than the last:

### Tier 1 — Declarative content (most things should live here)

Data, validated by a JSON schema; no code runs.

- **Prefabs:** an entity = components (`Mesh`, `Health`, `AI:wander`,
  `Spawner`, `Trigger`, `Weather`, …). "Summon a giant chicken" → a prefab
  instance with scale, model, behavior preset.
- **Rules as trigger → condition → action**:

```jsonc
{
  "id": "lava-floor",
  "scope": { "region": "arena-1" },          // rules are always scoped
  "when": { "event": "tick", "every": "30s" },
  "if":   { "all": [{ "playersIn": "arena-1", "gte": 2 }] },
  "then": [
    { "fillBlocks": { "layer": "y=10", "block": "lava", "region": "arena-1" } },
    { "broadcast": { "text": "The floor is lava!" } }
  ],
  "limits": { "maxFires": 20 }
}
```

- **Scenario = a bundle** of prefabs + rules + region + roles + win/lose
  conditions + lifetime. Scenarios can be started, paused, voted on, ended, and
  rolled back as a unit.

The rule engine only exposes a fixed set of actions, each with a cost. You can
fully validate, cost and preview this tier before it runs.

### Tier 2 — Sandboxed scripts (for logic the DSL can't express)

- Run on the **server only**, in QuickJS/Luau wasm instances inside a worker
  pool, one isolate per scenario.
- **Capability API only**: `world.getBlock`, `world.setBlocks(region, …)`,
  `entities.spawn(prefab)`, `events.on(...)`, `timer.after(...)`. No network,
  no filesystem, no access to other scenarios' state, no access to players
  outside the scenario's scope unless granted.
- **Hard limits:** instruction fuel per tick (e.g. 2 ms), memory cap
  (e.g. 16–64 MB), max entities/blocks changed per second, max timers. If it
  goes over, the script is suspended and its creator is notified.
- All side effects go through the same transaction log as Tier 1, so they can
  be undone.

### Tier 3 — AI "summon" (natural language → Tier 1/2 content)

The LLM is a **content author**, not a privileged operator.

```
player prompt
  → moderation (input)                               reject harmful/abusive requests
  → planner LLM with tools: create_prefab, create_rule, fill_region, write_script …
  → output = DSL / script / asset request (never executed directly)
  → schema validation + static checks + cost estimate
  → dry run in a "shadow" copy of the affected region (N ticks)
  → moderation (output: names, text, generated models/textures)
  → permission + budget check (role, per-player quota, world caps)
  → optional: preview ghost / host approval / player vote
  → commit as one transaction (undoable), tagged with creator + prompt
```

Important details:

- **Prompt injection:** in-world text (signs, chat, other players' names)
  that reaches the model is treated as untrusted data, clearly delimited, and the
  model has no tools beyond the ones the requesting player is allowed to use.
- **Assets:** start with voxel models generated as data (the LLM emits a voxel
  grid or a composition of primitives); later add text-to-3D/image models →
  voxelize → moderate → cache. Cache by prompt hash so popular summons are free.
- **Cost control:** per-player and per-world AI quotas, cheap model for
  classification/repairs, streaming "ghost" previews while generating.

### Composing many players' rules at once

With 30+ people adding rules live, conflicts are guaranteed. Handle them by
design:

- Every rule/script has a **scope** (region, entity set, or player set) and an
  **owner**. Outside its scope it does nothing.
- **Priority order:** world rules > host > scenario owner > player. Rules that
  touch the same thing in the same tick are resolved by priority, then time.
- **Protected zones:** spawn, other people's builds, and "core" rules can be
  locked.
- **Global caps** (entities, particles, lights, block changes/sec) are enforced
  by the server no matter who asks, so no single scenario can cause lag for
  everyone.

---

## 5. Safeguards & best practices checklist

**Server authority & anti-cheat**
- Clients send intents (move, place, use, summon-request), never state.
- Validate reach, speed, cooldowns, inventory server-side.
- Rate-limit every message type per connection; drop/kick on abuse.

**Untrusted code**
- No user or AI code ever runs in other players' browsers. Clients only render
  data from a fixed set of known component types.
- Sandbox = wasm interpreter + worker/process isolation + resource limits +
  capability API. Assume the interpreter can be escaped; keep the worker
  process low-privilege with no secrets and no network egress.

**Content & community safety**
- Moderate prompts, generated text, names, signs, chat and generated
  images/models (classifier + blocklists + human review queue).
- Roles: owner / host / builder / player / spectator, with per-role tool
  permissions and quotas.
- Report, mute, kick, ban; per-world "safe mode" that disables summoning.
- If minors may play: age gating, restricted chat, no free text to strangers,
  and the relevant legal reviews (COPPA/GDPR-K, DSA).

**Operational safety**
- Kill switch per scenario, per player, and per world ("freeze all scripts").
- Snapshots + event log → point-in-time rollback; one-click "undo everything
  player X did in the last 10 minutes".
- Audit log: who/what prompt created each entity/rule.
- Metrics per shard: tick time, script fuel used, bandwidth per client, AI spend.
- Load-test with bots (headless clients) at 2–3× target player count.

**Web platform**
- Strict CSP, no `eval` on the client, no user HTML.
- Auth with short-lived tokens on the socket; re-validate on reconnect.
- Version the protocol; reject mismatched clients cleanly.

---

## 6. Suggested build order

| Phase | Outcome | Rough effort (1–3 devs, AI-assisted) |
|---|---|---|
| 0. Prototype | Single-player voxel world in Three.js: chunk streaming, greedy meshing in workers, place/break blocks, first/third-person controller | 1–2 weeks |
| 1. Multiplayer core | Authoritative server, 30 players in one world, prediction/interpolation, chat, persistence of chunks | 2–4 weeks |
| 2. Declarative layer | Prefab + rule DSL, scenarios with regions/roles, undo, host tools, in-game editor UI | 3–5 weeks |
| 3. AI summon | AI gateway with tools → DSL, validation, shadow dry run, moderation, quotas, previews | 2–4 weeks |
| 4. Scripts | QuickJS/Luau sandbox pool with capability API and budgets | 2–3 weeks |
| 5. Polish & scale | Weather/lighting, crowds via instancing, WebTransport, load tests at 100+ players, moderation tooling | ongoing |

Do Phase 3 **before** Phase 4: an AI that can only write validated DSL already
covers most "summon X / make a game mode where Y" requests and is much safer
than open scripting.

---

## 7. Open decisions

1. **TypeScript vs Rust server** — TS is faster to build and shares code with the
   client; Rust (or SpacetimeDB) gives headroom for large sims.
2. **Colyseus vs SpacetimeDB vs custom** — Colyseus = familiar rooms model;
   SpacetimeDB = logic in the database, persistence built in; custom = most
   control over voxel-specific bandwidth tricks.
3. **Script language** — JS/TS (QuickJS) is what LLMs write best; Luau has a
   proven game-sandbox track record (Roblox).
4. **One big persistent world vs many session worlds** — session worlds
   (like the 30-person test events) are much simpler to run and moderate; start there.

## References

- Spawn / @jsnnsa posts on building multiplayer worlds with AI: https://x.com/jsnnsa/status/2064420561078693941, https://x.com/jsnnsa/status/2021763028845572204
- SpacetimeDB + Three.js: https://discourse.threejs.org/t/spacetimedb-threejs-support-and-free-tier/90052
- Three.js + SpacetimeDB multiplayer starter: https://github.com/majidmanzarpour/vibe-coding-starter-pack-3d-multiplayer
- noa-engine-based browser voxel game: https://github.com/luispolis124/voxel-game-web
- Multiplayer voxel browser engine write-up: https://kevzettler.com/2023/04/25/multiplayer-voxel-game-engine/
- QuickJS WebAssembly sandbox: https://sebastianwessel.de/projects/quickjs-sandbox/
- Why language sandboxes are not enough on their own (microVM isolation): https://www.pandastack.ai/blog/microvm-game-mod-execution-isolation/
