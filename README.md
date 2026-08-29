# BIDSTREAM

A perpetual AI-generated video livestream. Anyone — human or agent — bids to air
their prompt. Highest price-per-second airs next. When nothing is queued, past
clips replay, weighted by what they paid.

[`BUILD_SPEC.md`](./BUILD_SPEC.md) is the source of truth for product decisions,
milestones and the things v1 deliberately does not build.

**Status: M0 (skeleton) complete.** The player, HUD, database schema, env config
and economics guardrail are real and running. Generation, payments, moderation
and the broadcaster are not built yet.

---

## Run it

```bash
npm install
cp .env.example .env          # works as-is; DATABASE_URL is optional at M0
npm run dev                   # http://localhost:3000
```

Without `DATABASE_URL` the page still runs: the player loops the standby clip and
the HUD reports `degraded` with empty queue state. With Postgres:

```bash
createdb bidstream
echo 'DATABASE_URL=postgres://localhost:5432/bidstream' >> .env
npm run db:migrate
```

Other commands:

| Command | What it does |
|---|---|
| `npm run test` | Unit tests for the pricing and queue-ordering rules |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run check:economics` | §9 guardrail: every tier floor must clear 3x its generation cost |
| `npm run db:migrate` | Applies `db/migrations/*.sql` once each, in order |
| `npm run db:reset` | Drops and recreates the schema first (refuses in production) |
| `./scripts/make-placeholder.sh` | Regenerates the standby mp4 (needs ffmpeg) |

## What exists after M0

```
src/lib/tiers.ts        Tier table, floor prices, surge, the 3x economics guardrail
src/lib/selection.ts    Queue ordering, ETA, weighted rotation picking — all pure
src/lib/state.ts        The single HUD payload: now playing, queue, floors, viewers
src/lib/db.ts           pg pool, query/transaction helpers
src/lib/events.ts       Append-only event log; never throws into a payment path
src/lib/viewers.ts      In-process viewer presence (heartbeat + TTL)
src/components/Player.tsx  HLS.js with an mp4 standby fallback
src/components/Hud.tsx     The overlay: now playing, queue, floors, QR
db/migrations/          Schema (§4)
```

Two endpoints back the front page:

- `GET /api/state?v=<viewer-id>` — the whole HUD payload, and the viewer heartbeat.
- `GET /api/health` — DB reachability plus the per-tier economics table. Returns
  503 if the guardrail fails or the DB is down.

### Money rules, in one place

`src/lib/tiers.ts` holds every number that decides what a bid costs and where it
lands. Tiers are A 7s/$3, B 14s/$8, C 21s/$20, +$2 for an image bid. Ranking is
`amount_cents / duration_s`, descending, ties by `created_at` — so a floor-priced
C ($0.95/s) always outranks a floor-priced A ($0.43/s), and the only way to jump
the queue is to pay more per second. Top-ups work by raising `amount_cents` on a
pending bid, which is why `price_per_sec` is a generated column: it can't drift.

The economics assertion runs at boot (`src/instrumentation.ts`), so the app
refuses to start if a tier floor ever stops covering 3x its generation cost.

### Standby behaviour

The player prefers `NEXT_PUBLIC_HLS_URL` and falls back to the looping standby
mp4 whenever the playlist is missing or HLS errors fatally, re-checking every 15s
so it picks the broadcaster up when it comes online. Dead air is the only
unacceptable state (§7) — that rule is enforced on the client as well as in the
broadcaster.

## Next: M1 — generation pipeline

`bid.ts "prompt" --tier B [--image x.png]` → fal (t2v or i2v) → R2 → a row in
`clips`, with cost and latency logged per generation. Nothing generates
speculatively: only paid, approved bids (§1).
