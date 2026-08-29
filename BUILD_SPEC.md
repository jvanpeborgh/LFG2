# BIDSTREAM — Build Spec v1

A perpetual AI-generated video livestream where anyone (humans or agents) bids to air their prompt. Highest price-per-second airs next; when the queue is empty, past clips replay weighted by amount paid. Simple, robust, three tiers, no interrupts.

> This file is the source of truth. Locked decisions are marked LOCKED — don't redesign them. Open items are in §12. Build milestone by milestone (§10); each milestone must run end-to-end before starting the next.

---

## 1. Product decisions (LOCKED)

| Area | Decision |
|---|---|
| Airtime model | Strict queue, ordered by price-per-second desc, ties by created_at. No interrupts/takeovers in v1. |
| Tiers | A: 7s / $3 min · B: 14s / $8 min · C: 21s / $20 min. Image-input bids: +$2 on each tier. |
| Top-ups | A bidder can add money to a pending bid to climb the queue (this is the drama mechanic). |
| Idle behavior | Rotation: replay aired clips, selection weight ∝ total paid; ~1 in 10 idle slots uniformly random from archive. |
| Inputs | Text prompt (required) + optional single image (start frame). 16:9 enforced (crop/letterbox at upload). |
| Payments | Stripe (cards) + USDC via x402 (Base and/or Solana). Same bid API for both. |
| Agents | First-class: public `POST /api/bid` returns HTTP 402 with x402 payment terms. Document in /llms.txt. |
| Identity | No accounts. handle + optional url + email-or-wallet as receipt. Magic link to manage a bid. |
| Refunds | Automatic full refund on moderation rejection or generation failure. Never keep money for un-aired clips. |
| Artifacts | Every aired clip gets a permanent page /v/:id (video, prompt, handle, amount, aired-at). Opt-in tweet on air. |
| On-screen HUD | Live viewer count, queue depth, current clip's handle+amount, floor prices, QR code to /bid. |
| Generation | fal MiniMax H3 Max. text-to-video for text bids; image-to-video (uploaded image = start frame) for image bids. 768p, 16:9, 24fps, native audio. ~$0.08/sec. Never generate speculatively — only paid, approved bids. |
| Moderation | Own gate BEFORE charging/generating (see §6). fal's built-in filter is backstop only. |

## 2. Non-goals for v1 (do NOT build)

Takeovers/interrupts · morph transitions (plain crossfade only) · reference-to-video characters · accounts/auth · daily-reset leaderboard · multi-channel · mobile apps · admin dashboard beyond a simple review page.

## 3. Suggested stack

(Equivalents may be substituted, but keep it boring.)

- **App**: Next.js (App Router) + TypeScript, deployed on a VPS or Fly.io (the broadcaster needs a long-running process — pure serverless won't work).
- **DB**: Postgres (Neon/Supabase) — bids, clips, payments, events.
- **Queue/worker**: single Node worker process (BullMQ + Redis, or a simple Postgres-polling loop — prefer the simpler one).
- **Storage/CDN**: Cloudflare R2 + CDN for mp4s and HLS segments.
- **Broadcaster**: dedicated process running ffmpeg (see §7).
- **Payments**: Stripe Checkout (one-time payments) + x402 middleware for USDC.
- **Realtime**: one WebSocket (or SSE) channel for HUD state: viewer count, queue, now-playing.

## 4. Data model (minimum)

```
bids:      id, handle, url?, contact (email|wallet), prompt, image_url?,
           tier (A|B|C), amount_cents, currency, price_per_sec (derived),
           status (pending_payment|queued|generating|ready|aired|rejected|failed|refunded),
           moderation_verdict?, rejection_reason?, payment_provider (stripe|x402),
           payment_ref, created_at, aired_at?
clips:     id, bid_id, r2_url, duration_s, last_frame_url?, times_aired, created_at
plays:     id, clip_id, started_at, kind (queue|rotation|random)
events:    append-only log (bid_created, paid, approved, rejected, generated, aired, refunded)
```

## 5. Core flow

```
POST /api/bid
  → validate tier/prompt/image
  → moderation gate (§6)
      reject → 422 + reason (nothing charged)
  → create bid (pending_payment)
  → web: Stripe Checkout URL | agent: HTTP 402 + x402 terms
payment webhook / x402 proof verified
  → status=queued → worker picks up by price_per_sec desc
worker:
  → fal generate (t2v or i2v; duration=tier; 16:9; audio on)
  → check output flags (fal has_nsfw_concepts etc.) → fail = refund
  → upload mp4 to R2, extract last frame, status=ready
broadcaster:
  → next = highest ready bid, else rotation pick (§1)
  → play; on start: mark aired, fire opt-in tweet, update HUD
```

## 6. Moderation gate (build in M4, stub as "approve all + log" before that)

Two calls, both before payment capture:

1. **Prompt check** — one LLM moderation call against this policy. HARD BLOCK: sexual content involving minors; real identifiable/named people (incl. politicians, celebrities); NCII; explicit threats/incitement; instructions for weapons/harm; scam/phishing content or URLs in the video. SOFT BLOCK (config flag `SIMULCAST_SAFE`, default on): nudity/sexual content, gore, slurs, famous trademarked characters/brands (other than the bidder's own uploaded logo). Everything else passes — edgy/weird/absurd/political-in-general is fine and is the product.
2. **Image check** (if image) — NSFW probability via fal `imageutils/nsfw` (threshold ~0.7) + one vision-LLM question: "recognizable real person, celebrity, or famous third-party brand mark?" → block if yes.
3. Log every verdict with reasons to `events`. Rejected bids are never charged (Stripe: don't capture; x402: refund transfer).
4. Output backstop: if fal flags the generated video or returns black frames, mark failed + refund; never enqueue.

## 7. Broadcaster (the tricky part — keep it dumb)

- Single long-running process. Maintains a "next up" decision loop (§5) and feeds ffmpeg.
- v1 approach: ffmpeg reading clips sequentially (concat via named pipe or restarting per-clip behind a persistent HLS muxer), producing HLS (2–4s segments) written to R2/local + served via CDN. 0.5s crossfade between clips if easy (xfade); a branded 0.3s stinger/dissolve overlay is an acceptable substitute.
- Between clips, overlay HUD is client-side (HTML over the `<video>`), NOT burned into the stream — except the QR + handle+amount lower-third, which SHOULD be burned in (drawtext/overlay) so it survives restreams and screen recordings.
- Optional: RTMP push of the same output to Twitch/YouTube (env-gated, off by default until moderation is live).
- Crash policy: on any error, fall back to looping the rotation playlist. Dead air is the only unacceptable state.

## 8. Pages

| Route | Content |
|---|---|
| `/` | Player (HLS.js) + HUD: viewers, now playing (handle, amount, prompt), queue list (position, handle, $, ETA), floor prices, QR, "Bid" CTA |
| `/bid` | Form: prompt, tier picker w/ live floor price, optional image upload w/ 16:9 crop, handle, url, contact, opt-in tweet checkbox → Stripe Checkout |
| `/v/:id` | Permalink: video, prompt, handle+url, amount, aired-at badge, "Outbid this" CTA, OG tags for rich sharing |
| `/api/bid` | Agent endpoint (402/x402 flow) |
| `/llms.txt` | One-page API doc for agents |
| `/about` | Rules/TOS: we may reject anything (auto-refund); no real people; no third-party IP; clips are public forever; 18+ ban list |

## 9. Economics guardrails

- Assert at boot: `min_bid(tier) > gen_cost(tier) * 3` (gen cost = duration × $0.08).
- Surge: if projected queue wait > 30 min, raise displayed floor prices 25% per 15 min of backlog (cap 4x); decay back when queue drains.
- Daily spend cap on fal key (env: `MAX_DAILY_GEN_USD`, default $200) → past cap, new bids get "queue paused" message, nothing charged.

## 10. Milestones (each ends runnable)

- **M0 — Skeleton**: repo, DB schema, env config, `/` with a static looping mp4 through the real player.
- **M1 — Gen pipeline**: CLI `bid.ts "prompt" --tier B [--image x.png]` → fal → R2 → row in clips. Verify cost + latency logging.
- **M2 — Queue + broadcaster**: bids table drives the stream; rotation when empty; HUD via WebSocket; manual/free bids via a dev page.
- **M3 — Payments**: Stripe Checkout + webhook → queued. x402 on `/api/bid`. Refund paths tested.
- **M4 — Moderation**: full §6 gate wired before payment; admin review page for a random sample + all rejections.
- **M5 — Shareability**: /v/:id permalinks + OG images, opt-in Twitter bot on air, QR overlay burned in.
- **M6 — Launch hardening**: surge pricing, spend cap, crash-fallback loop, rate limiting on /api/bid, basic analytics, seed 15–20 house clips, dry-run day with friends' bids.

## 11. Env vars

`FAL_KEY, DATABASE_URL, REDIS_URL?, R2_*, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, X402_WALLET/NETWORK, MODERATION_LLM_KEY, TWITTER_API_*, SIMULCAST_SAFE=true, MAX_DAILY_GEN_USD=200, RTMP_TWITCH_URL?`

## 12. Open questions (decide during build, don't block on them)

1. Queue prompts public before airing, or blurred until aired? (Public = more fun, enables prompt-sniping — leaning public.)
2. HLS latency target: standard (~10–20s, easy) vs low-latency HLS (harder). v1: standard is fine.
3. x402 network: Base, Solana, or both? Pick whichever SDK is smoothest, add the other later.
4. Entity/jurisdiction + real TOS review before spending on ads (not before launch).
5. Twitter bot: dedicated account name — reserve the handle early, same as domain.

## 13. Definition of done (v1 launch)

A stranger with a phone can: scan the QR → pay $3 by card → see their clip air within ~5 min → get a permalink → get tweeted. An agent with a wallet can do the same via one HTTP call. A malicious bid gets rejected and refunded without a human awake. The stream has not shown dead air or a black frame in 48h of soak.

---

## Build log (append per milestone)

### M0 — Skeleton ✅

- Next.js 15 App Router + TypeScript app, Postgres schema, zod-validated env config.
- `/` renders the real player (HLS.js with mp4 fallback) looping a locally generated placeholder clip, with the client-side HUD shell wired to `/api/state`.
- Economics assertion (§9) runs at boot and as `npm run check:economics`.
- Decisions taken here, recorded so they are not re-litigated:
  - **Queue/worker**: Postgres-polling loop, no Redis. `REDIS_URL` stays unused in v1 (§3 says prefer the simpler one).
  - **`price_per_sec`** is a stored generated column = `amount_cents / duration_s`, so ordering is index-backed and can never drift from the amount. The image surcharge is included in `amount_cents` and therefore does buy a small amount of queue position; accepted as noise at v1 volumes.
  - **`payments` table added** beyond the §4 minimum. Top-ups (LOCKED) and refunds both need a per-transaction ledger with an idempotency key; folding them into `bids.payment_ref` would lose history.
  - **`bids.duration_s` stored** rather than derived from tier at read time, so the generated `price_per_sec` column and any future tier re-pricing stay correct for already-placed bids.
  - **Open question 1 → public.** Queue prompts are visible before airing. `/api/state` exposes them.
  - **Open question 2 → standard-latency HLS.** No LL-HLS in v1.
