import { isDatabaseConfigured, query } from './db'
import { backlogSeconds, etaSeconds, type RankableBid } from './selection'
import { floorPriceCents, surgeMultiplier, TIER_ORDER, type Tier } from './tiers'
import { viewerCount } from './viewers'

/** Everything the HUD needs, in one payload (§8 `/`). */
export interface StreamState {
  nowPlaying: NowPlaying | null
  queue: QueueEntry[]
  queueDepth: number
  backlogSeconds: number
  surgeMultiplier: number
  floors: Record<Tier, number>
  viewers: number
  archiveCount: number
  /** True when the DB is unreachable or unset: the player still runs. */
  degraded: boolean
  updatedAt: string
}

export interface NowPlaying {
  clipId: string
  bidId: string | null
  handle: string | null
  url: string | null
  prompt: string | null
  amountCents: number | null
  durationSeconds: number
  startedAt: string
  kind: 'queue' | 'rotation' | 'random'
}

export interface QueueEntry {
  bidId: string
  handle: string
  url: string | null
  /** Open question 1 → prompts are public before airing. */
  prompt: string
  tier: Tier
  amountCents: number
  durationSeconds: number
  pricePerSecCents: number
  status: string
  position: number
  etaSeconds: number | null
}

const QUEUE_LIMIT = 25

export function emptyState(degraded: boolean): StreamState {
  return {
    nowPlaying: null,
    queue: [],
    queueDepth: 0,
    backlogSeconds: 0,
    surgeMultiplier: 1,
    floors: floorsFor(1),
    viewers: viewerCount(),
    archiveCount: 0,
    degraded,
    updatedAt: new Date().toISOString(),
  }
}

function floorsFor(surge: number): Record<Tier, number> {
  return Object.fromEntries(
    TIER_ORDER.map((tier) => [tier, floorPriceCents(tier, { surgeMultiplier: surge })]),
  ) as Record<Tier, number>
}

export async function getStreamState(): Promise<StreamState> {
  if (!isDatabaseConfigured()) return emptyState(true)

  try {
    const [nowRows, queueRows, archiveRows] = await Promise.all([
      query<NowPlayingRow>(
        `select p.clip_id, p.bid_id, p.kind, p.started_at,
                c.duration_s,
                b.handle, b.url, b.prompt, b.amount_cents
           from plays p
           join clips c on c.id = p.clip_id
           left join bids b on b.id = p.bid_id
          order by p.started_at desc
          limit 1`,
      ),
      query<QueueRow>(
        `select id, handle, url, prompt, tier, amount_cents, duration_s,
                price_per_sec, status, created_at
           from bids
          where status in ('queued', 'generating', 'ready')
          order by price_per_sec desc, created_at asc
          limit $1`,
        [QUEUE_LIMIT],
      ),
      query<{ count: string }>('select count(*)::text as count from clips'),
    ])

    const ranked: RankableBid[] = queueRows.map((r) => ({
      id: r.id,
      pricePerSecCents: Number(r.price_per_sec),
      createdAt: r.created_at,
      durationSeconds: r.duration_s,
    }))

    const backlog = backlogSeconds(ranked)
    const surge = surgeMultiplier(backlog / 60)
    const remaining = nowPlayingRemainingSeconds(nowRows[0])

    return {
      nowPlaying: nowRows[0] ? toNowPlaying(nowRows[0]) : null,
      queue: queueRows.map((r, index) => ({
        bidId: r.id,
        handle: r.handle,
        url: r.url,
        prompt: r.prompt,
        tier: r.tier,
        amountCents: r.amount_cents,
        durationSeconds: r.duration_s,
        pricePerSecCents: Number(r.price_per_sec),
        status: r.status,
        position: index + 1,
        etaSeconds: etaSeconds(ranked, r.id, remaining),
      })),
      queueDepth: queueRows.length,
      backlogSeconds: backlog,
      surgeMultiplier: surge,
      floors: floorsFor(surge),
      viewers: viewerCount(),
      archiveCount: Number(archiveRows[0]?.count ?? 0),
      degraded: false,
      updatedAt: new Date().toISOString(),
    }
  } catch (err) {
    console.error('[state] falling back to empty state', err)
    return emptyState(true)
  }
}

function nowPlayingRemainingSeconds(row: NowPlayingRow | undefined): number {
  if (!row) return 0
  const elapsed = (Date.now() - new Date(row.started_at).getTime()) / 1000
  return Math.max(0, Number(row.duration_s) - elapsed)
}

function toNowPlaying(row: NowPlayingRow): NowPlaying {
  return {
    clipId: row.clip_id,
    bidId: row.bid_id,
    handle: row.handle,
    url: row.url,
    prompt: row.prompt,
    amountCents: row.amount_cents,
    durationSeconds: Number(row.duration_s),
    startedAt: new Date(row.started_at).toISOString(),
    kind: row.kind,
  }
}

interface NowPlayingRow {
  clip_id: string
  bid_id: string | null
  kind: 'queue' | 'rotation' | 'random'
  started_at: string
  duration_s: string
  handle: string | null
  url: string | null
  prompt: string | null
  amount_cents: number | null
}

interface QueueRow {
  id: string
  handle: string
  url: string | null
  prompt: string
  tier: Tier
  amount_cents: number
  duration_s: number
  price_per_sec: string
  status: string
  created_at: string
}
