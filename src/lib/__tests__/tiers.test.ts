import { describe, expect, it } from 'vitest'
import {
  assertEconomics,
  economicsReport,
  floorPriceCents,
  genCostCents,
  IMAGE_SURCHARGE_CENTS,
  pricePerSecCents,
  surgeMultiplier,
  TIERS,
  validateBidAmount,
} from '../tiers'

describe('tier table', () => {
  it('matches the locked spec', () => {
    expect(TIERS.A).toMatchObject({ durationSeconds: 7, minAmountCents: 300 })
    expect(TIERS.B).toMatchObject({ durationSeconds: 14, minAmountCents: 800 })
    expect(TIERS.C).toMatchObject({ durationSeconds: 21, minAmountCents: 2000 })
  })

  it('prices higher tiers above lower ones per second, so C outranks A at floor', () => {
    const a = pricePerSecCents(TIERS.A.minAmountCents, TIERS.A.durationSeconds)
    const b = pricePerSecCents(TIERS.B.minAmountCents, TIERS.B.durationSeconds)
    const c = pricePerSecCents(TIERS.C.minAmountCents, TIERS.C.durationSeconds)
    expect(b).toBeGreaterThan(a)
    expect(c).toBeGreaterThan(b)
  })
})

describe('economics guardrail (§9)', () => {
  it('passes at the planned $0.08/sec', () => {
    expect(() => assertEconomics(0.08)).not.toThrow()
    expect(economicsReport(0.08).every((r) => r.ok)).toBe(true)
  })

  it('fails once generation gets expensive enough to eat the margin', () => {
    expect(() => assertEconomics(0.4)).toThrow(/Economics guardrail failed/)
  })

  it('rounds generation cost up to the cent', () => {
    expect(genCostCents(7, 0.08)).toBe(56)
    expect(genCostCents(21, 0.08)).toBe(168)
  })
})

describe('floor prices', () => {
  it('adds the image surcharge on top of the airtime price', () => {
    expect(floorPriceCents('A')).toBe(300)
    expect(floorPriceCents('A', { hasImage: true })).toBe(300 + IMAGE_SURCHARGE_CENTS)
  })

  it('surges the airtime price only, and never below the base', () => {
    expect(floorPriceCents('B', { surgeMultiplier: 2 })).toBe(1600)
    expect(floorPriceCents('B', { surgeMultiplier: 0.5 })).toBe(800)
    expect(floorPriceCents('B', { surgeMultiplier: 2, hasImage: true })).toBe(
      1600 + IMAGE_SURCHARGE_CENTS,
    )
  })
})

describe('surge (§9)', () => {
  it('is flat below the 30 minute threshold', () => {
    expect(surgeMultiplier(0)).toBe(1)
    expect(surgeMultiplier(30)).toBe(1)
  })

  it('steps up 25% per 15 minutes of backlog past the threshold', () => {
    expect(surgeMultiplier(31)).toBeCloseTo(1.25)
    expect(surgeMultiplier(45)).toBeCloseTo(1.5625)
  })

  it('caps at 4x', () => {
    expect(surgeMultiplier(100_000)).toBe(4)
  })
})

describe('bid validation', () => {
  it('rejects amounts under the current floor', () => {
    expect(validateBidAmount('A', 299)).toMatch(/at least/)
    expect(validateBidAmount('A', 300)).toBeNull()
  })

  it('accounts for surge and images', () => {
    expect(validateBidAmount('A', 300, { surgeMultiplier: 2 })).toMatch(/at least/)
    expect(validateBidAmount('A', 600, { surgeMultiplier: 2 })).toBeNull()
    expect(validateBidAmount('A', 300, { hasImage: true })).toMatch(/at least/)
    expect(validateBidAmount('A', 500, { hasImage: true })).toBeNull()
  })

  it('rejects non-integer or negative amounts', () => {
    expect(validateBidAmount('A', 300.5)).toMatch(/positive integer/)
    expect(validateBidAmount('A', -1)).toMatch(/positive integer/)
  })
})
