import { describe, expect, it } from 'vitest'
import {
  backlogSeconds,
  etaSeconds,
  pickRotation,
  queuePosition,
  rankQueue,
  type RankableBid,
} from '../selection'

function bid(id: string, pps: number, createdAt: string, duration = 7): RankableBid {
  return { id, pricePerSecCents: pps, createdAt, durationSeconds: duration }
}

describe('queue ordering (§1)', () => {
  it('sorts by price-per-second descending', () => {
    const ranked = rankQueue([
      bid('cheap', 42, '2026-01-01T00:00:00Z'),
      bid('rich', 200, '2026-01-01T00:05:00Z'),
      bid('mid', 95, '2026-01-01T00:02:00Z'),
    ])
    expect(ranked.map((b) => b.id)).toEqual(['rich', 'mid', 'cheap'])
  })

  it('breaks ties by created_at ascending — first money in, first to air', () => {
    const ranked = rankQueue([
      bid('later', 100, '2026-01-01T00:10:00Z'),
      bid('earlier', 100, '2026-01-01T00:01:00Z'),
    ])
    expect(ranked.map((b) => b.id)).toEqual(['earlier', 'later'])
  })

  it('puts a new bid behind existing bids at the same price', () => {
    const ranked = rankQueue([
      bid('a', 100, '2026-01-01T00:00:00Z'),
      bid('b', 50, '2026-01-01T00:00:00Z'),
    ])
    expect(queuePosition(ranked, 100)).toBe(2)
    expect(queuePosition(ranked, 101)).toBe(1)
    expect(queuePosition(ranked, 60)).toBe(2)
  })
})

describe('eta', () => {
  const ranked = rankQueue([
    bid('first', 200, '2026-01-01T00:00:00Z', 21),
    bid('second', 100, '2026-01-01T00:00:00Z', 14),
    bid('third', 50, '2026-01-01T00:00:00Z', 7),
  ])

  it('sums the airtime ahead of a bid plus what is on screen', () => {
    expect(etaSeconds(ranked, 'first', 5)).toBe(5)
    expect(etaSeconds(ranked, 'second', 5)).toBe(26)
    expect(etaSeconds(ranked, 'third', 5)).toBe(40)
  })

  it('returns null for a bid that is not queued', () => {
    expect(etaSeconds(ranked, 'ghost')).toBeNull()
  })

  it('reports total backlog', () => {
    expect(backlogSeconds(ranked)).toBe(42)
  })
})

describe('rotation (§1 idle behaviour)', () => {
  const candidates = [
    { clipId: 'whale', totalPaidCents: 9000 },
    { clipId: 'minnow', totalPaidCents: 1000 },
  ]

  it('returns null with an empty archive', () => {
    expect(pickRotation([], () => 0.5)).toBeNull()
  })

  it('takes the uniform-random branch roughly 1 in 10 slots', () => {
    // First rand() < 0.1 selects the random branch; the second picks the index.
    const rands = [0.05, 0.99]
    const pick = pickRotation(candidates, () => rands.shift() ?? 0)
    expect(pick).toEqual({ clipId: 'minnow', kind: 'random' })
  })

  it('weights the paid branch by money', () => {
    // total weight 10000; 0.5 -> 5000 lands inside the whale's 9000.
    expect(pickRotation(candidates, seq([0.5, 0.5]))).toEqual({
      clipId: 'whale',
      kind: 'rotation',
    })
    // 0.95 -> 9500 falls past the whale, into the minnow.
    expect(pickRotation(candidates, seq([0.5, 0.95]))).toEqual({
      clipId: 'minnow',
      kind: 'rotation',
    })
  })

  it('gives unpaid house clips a floor weight rather than zero', () => {
    const withHouse = [{ clipId: 'house', totalPaidCents: 0 }]
    expect(pickRotation(withHouse, seq([0.5, 0.5]))).toEqual({
      clipId: 'house',
      kind: 'rotation',
    })
  })

  it('avoids repeating the clip that just aired when there is an alternative', () => {
    const pick = pickRotation(candidates, seq([0.5, 0.5]), 'whale')
    expect(pick?.clipId).toBe('minnow')
  })

  it('repeats rather than going dark when it is the only clip', () => {
    const only = [{ clipId: 'solo', totalPaidCents: 500 }]
    expect(pickRotation(only, seq([0.5, 0.5]), 'solo')?.clipId).toBe('solo')
  })
})

function seq(values: number[]): () => number {
  const queue = [...values]
  return () => queue.shift() ?? 0
}
