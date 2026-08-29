-- BIDSTREAM initial schema (§4 of BUILD_SPEC.md).
-- Postgres 14+.

create extension if not exists "pgcrypto";

do $$ begin
  create type bid_tier as enum ('A', 'B', 'C');
exception when duplicate_object then null; end $$;

do $$ begin
  create type bid_status as enum (
    'pending_payment', 'queued', 'generating', 'ready',
    'aired', 'rejected', 'failed', 'refunded'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_provider as enum ('stripe', 'x402');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_kind as enum ('initial', 'topup', 'refund');
exception when duplicate_object then null; end $$;

do $$ begin
  create type play_kind as enum ('queue', 'rotation', 'random');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- bids ----
create table if not exists bids (
  id              uuid primary key default gen_random_uuid(),
  handle          text not null check (length(handle) between 1 and 40),
  url             text,
  -- email or wallet address; no accounts (§1).
  contact         text not null,
  prompt          text not null check (length(prompt) between 1 and 2000),
  image_url       text,
  tier            bid_tier not null,
  -- Stored, not derived from tier at read time, so already-placed bids keep
  -- their airtime and price_per_sec if tier durations are ever re-cut.
  duration_s      integer not null check (duration_s > 0),
  amount_cents    integer not null check (amount_cents > 0),
  currency        text not null default 'usd',
  price_per_sec   numeric(12, 4)
                    generated always as (amount_cents::numeric / duration_s) stored,
  status          bid_status not null default 'pending_payment',
  moderation_verdict jsonb,
  rejection_reason   text,
  payment_provider   payment_provider,
  payment_ref        text,
  opt_in_tweet    boolean not null default false,
  created_at      timestamptz not null default now(),
  paid_at         timestamptz,
  aired_at        timestamptz
);

-- The two hot reads: the worker pulling paid work, and the broadcaster picking
-- what airs next. Both are (price desc, created_at asc) over one status.
create index if not exists bids_queued_rank_idx
  on bids (price_per_sec desc, created_at asc)
  where status = 'queued';

create index if not exists bids_ready_rank_idx
  on bids (price_per_sec desc, created_at asc)
  where status = 'ready';

create index if not exists bids_status_created_idx on bids (status, created_at desc);
create index if not exists bids_payment_ref_idx on bids (payment_provider, payment_ref);

-- --------------------------------------------------------------- clips ----
create table if not exists clips (
  id             uuid primary key default gen_random_uuid(),
  bid_id         uuid not null unique references bids (id) on delete cascade,
  r2_key         text not null,
  r2_url         text not null,
  duration_s     numeric(6, 2) not null check (duration_s > 0),
  last_frame_url text,
  times_aired    integer not null default 0,
  -- House/seed clips (§10 M6) have no money behind them; rotation still needs
  -- a weight for them, so it comes from the bid row's amount.
  created_at     timestamptz not null default now()
);

create index if not exists clips_created_idx on clips (created_at desc);

-- --------------------------------------------------------------- plays ----
create table if not exists plays (
  id         uuid primary key default gen_random_uuid(),
  clip_id    uuid not null references clips (id) on delete cascade,
  bid_id     uuid references bids (id) on delete set null,
  kind       play_kind not null,
  started_at timestamptz not null default now(),
  ended_at   timestamptz
);

create index if not exists plays_started_idx on plays (started_at desc);
create index if not exists plays_clip_idx on plays (clip_id, started_at desc);

-- ------------------------------------------------------------ payments ----
-- Beyond the §4 minimum: top-ups (LOCKED) and automatic refunds both need a
-- per-transaction ledger with an idempotency key. bids.payment_ref alone
-- cannot hold more than one transaction.
create table if not exists payments (
  id            uuid primary key default gen_random_uuid(),
  bid_id        uuid not null references bids (id) on delete cascade,
  provider      payment_provider not null,
  -- Stripe session/PaymentIntent id, or the x402 settlement tx hash.
  provider_ref  text not null,
  kind          payment_kind not null,
  -- Positive for initial/topup, negative for refund.
  amount_cents  integer not null,
  currency      text not null default 'usd',
  raw           jsonb,
  created_at    timestamptz not null default now(),
  unique (provider, provider_ref, kind)
);

create index if not exists payments_bid_idx on payments (bid_id, created_at);

-- -------------------------------------------------------------- events ----
-- Append-only. Never updated, never deleted.
create table if not exists events (
  id         bigserial primary key,
  type       text not null,
  bid_id     uuid references bids (id) on delete set null,
  clip_id    uuid references clips (id) on delete set null,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists events_type_created_idx on events (type, created_at desc);
create index if not exists events_bid_idx on events (bid_id, created_at);

-- --------------------------------------------------------- gen spending ----
-- Daily fal spend, for the MAX_DAILY_GEN_USD cap (§9).
create table if not exists gen_spend (
  day        date primary key,
  cents      integer not null default 0,
  updated_at timestamptz not null default now()
);
