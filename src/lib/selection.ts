/**
 * What airs next (§1 idle behaviour, §5 broadcaster loop).
 *
 * Pure: the broadcaster passes in rows and a random source, so every path
 * here is testable without a database or a clock.
 */

export interface RankableBid {
  id: string
  pricePerSecCents: number
  createdAt: Date | string
  durationSeconds: number
}

export interface RotationCandidate {
  clipId: string
  /** Total money ever paid for this clip's bid, including top-ups. */
  totalPaidCents: number
}

export type PlayKind = 'queue' | 'rotation' | 'random'

/** ~1 in 10 idle slots is a uniform pick from the whole archive (LOCKED, §1). */
export const RANDOM_ROTATION_SHARE = 0.1

/**
 * Strict queue order: price-per-second desc, ties by created_at asc.
 * No interrupts, no takeovers — a bid that is already airing keeps the slot.
 */
export function rankQueue<T extends RankableBid>(bids: readonly T[]): T[] {
  return [...bids].sort((a, b) => {
    if (b.pricePerSecCents !== a.pricePerSecCents) {
      return b.pricePerSecCents - a.pricePerSecCents
    }
    return time(a.createdAt) - time(b.createdAt)
  })
}

/**
 * Where a hypothetical bid would land, 1-indexed. Ties go behind existing
 * bids at the same price, matching the created_at tiebreak.
 */
export function queuePosition(
  ranked: readonly RankableBid[],
  candidatePricePerSecCents: number,
): number {
  const ahead = ranked.filter((b) => b.pricePerSecCents >= candidatePricePerSecCents).length
  return ahead + 1
}

/** Airtime backlog in seconds: what a new bottom-of-queue bid waits for. */
export function backlogSeconds(ranked: readonly RankableBid[]): number {
  return ranked.reduce((sum, b) => sum + b.durationSeconds, 0)
}

/** Estimated seconds until a given bid airs, given its position in `ranked`. */
export function etaSeconds(
  ranked: readonly RankableBid[],
  bidId: string,
  nowPlayingRemainingSeconds = 0,
): number | null {
  const index = ranked.findIndex((b) => b.id === bidId)
  if (index === -1) return null
  const ahead = ranked.slice(0, index).reduce((sum, b) => sum + b.durationSeconds, 0)
  return Math.max(0, Math.round(nowPlayingRemainingSeconds + ahead))
}

export interface RotationPick {
  clipId: string
  kind: Extract<PlayKind, 'rotation' | 'random'>
}

/**
 * Idle-slot pick: weight by total paid, except roughly 1 in 10 slots which are
 * uniform over the archive so cheap clips still resurface.
 *
 * `rand` must return [0, 1). `excludeClipId` avoids airing the same clip twice
 * in a row when there is anything else to play.
 */
export function pickRotation(
  candidates: readonly RotationCandidate[],
  rand: () => number = Math.random,
  excludeClipId?: string,
): RotationPick | null {
  if (candidates.length === 0) return null

  let pool = candidates
  if (excludeClipId && candidates.length > 1) {
    pool = candidates.filter((c) => c.clipId !== excludeClipId)
    if (pool.length === 0) pool = candidates
  }

  if (rand() < RANDOM_ROTATION_SHARE) {
    const index = Math.min(pool.length - 1, Math.floor(rand() * pool.length))
    return { clipId: pool[index].clipId, kind: 'random' }
  }

  // Every clip keeps a floor weight so a $0 house clip is rare, not impossible.
  const weights = pool.map((c) => Math.max(1, c.totalPaidCents))
  const total = weights.reduce((a, b) => a + b, 0)
  let target = rand() * total
  for (let i = 0; i < pool.length; i++) {
    target -= weights[i]
    if (target < 0) return { clipId: pool[i].clipId, kind: 'rotation' }
  }
  return { clipId: pool[pool.length - 1].clipId, kind: 'rotation' }
}

function time(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime()
}
