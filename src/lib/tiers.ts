/**
 * Tiers, pricing and the §9 economics guardrails.
 *
 * Pure module — no I/O, no env reads except through explicit arguments — so
 * the money rules are unit-testable and can be imported from the browser.
 */

export type Tier = 'A' | 'B' | 'C'

export interface TierSpec {
  tier: Tier
  /** Airtime bought, in seconds. Also the fal generation duration. */
  durationSeconds: number
  /** Floor price at surge 1.0, in cents, for a text-only bid. */
  minAmountCents: number
  label: string
}

export const TIERS: Record<Tier, TierSpec> = {
  A: { tier: 'A', durationSeconds: 7, minAmountCents: 300, label: '7 seconds' },
  B: { tier: 'B', durationSeconds: 14, minAmountCents: 800, label: '14 seconds' },
  C: { tier: 'C', durationSeconds: 21, minAmountCents: 2000, label: '21 seconds' },
}

export const TIER_ORDER: Tier[] = ['A', 'B', 'C']

/** Image-input bids cost +$2 on every tier (LOCKED, §1). */
export const IMAGE_SURCHARGE_CENTS = 200

/** Surge caps and steps (§9). */
export const SURGE_FREE_WAIT_MINUTES = 30
export const SURGE_STEP_MINUTES = 15
export const SURGE_STEP_MULTIPLIER = 1.25
export const SURGE_MAX_MULTIPLIER = 4

export function isTier(value: unknown): value is Tier {
  return value === 'A' || value === 'B' || value === 'C'
}

export function tierSpec(tier: Tier): TierSpec {
  return TIERS[tier]
}

/** Cost to generate `seconds` of video, in cents, at the configured rate. */
export function genCostCents(seconds: number, usdPerSecond: number): number {
  // Round to sub-cent precision first: 7 * 0.08 * 100 is 56.000000000000007 in
  // binary floating point, and a naive ceil would bill an extra cent.
  return Math.ceil(Number((seconds * usdPerSecond * 100).toFixed(6)))
}

/**
 * Ranking key. Ties are broken by created_at ascending at the SQL level; this
 * function only produces the price component.
 */
export function pricePerSecCents(amountCents: number, durationSeconds: number): number {
  if (durationSeconds <= 0) throw new Error('durationSeconds must be > 0')
  return amountCents / durationSeconds
}

/**
 * Displayed floor for a tier, including the image surcharge and any surge.
 * Surge scales the airtime price only — the surcharge is a pass-through cost.
 * Rounded up to the nearest 25c so the UI never shows a floor a bid would miss.
 */
export function floorPriceCents(
  tier: Tier,
  opts: { hasImage?: boolean; surgeMultiplier?: number } = {},
): number {
  const { hasImage = false, surgeMultiplier = 1 } = opts
  const base = TIERS[tier].minAmountCents * clampSurge(surgeMultiplier)
  const rounded = Math.ceil(base / 25) * 25
  return rounded + (hasImage ? IMAGE_SURCHARGE_CENTS : 0)
}

export function clampSurge(multiplier: number): number {
  // NaN and sub-1 values mean "no surge"; +Infinity (a long backlog compounds
  // past Number.MAX_VALUE) must still clamp to the cap, not fall back to 1.
  if (Number.isNaN(multiplier) || multiplier < 1) return 1
  return Math.min(multiplier, SURGE_MAX_MULTIPLIER)
}

/**
 * §9 surge: nothing until the projected wait passes 30 min, then +25%
 * (compounding) for every further 15 min of backlog, capped at 4x. Decay is
 * implicit — the multiplier is recomputed from the live queue each time.
 */
export function surgeMultiplier(projectedWaitMinutes: number): number {
  if (!Number.isFinite(projectedWaitMinutes) || projectedWaitMinutes <= SURGE_FREE_WAIT_MINUTES) {
    return 1
  }
  const over = projectedWaitMinutes - SURGE_FREE_WAIT_MINUTES
  const steps = Math.floor(over / SURGE_STEP_MINUTES) + 1
  return clampSurge(SURGE_STEP_MULTIPLIER ** steps)
}

export interface EconomicsRow {
  tier: Tier
  durationSeconds: number
  minAmountCents: number
  genCostCents: number
  marginMultiple: number
  ok: boolean
}

export const MIN_MARGIN_MULTIPLE = 3

/** `min_bid(tier) > gen_cost(tier) * 3` for every tier (§9). */
export function economicsReport(usdPerSecond: number): EconomicsRow[] {
  return TIER_ORDER.map((tier) => {
    const spec = TIERS[tier]
    const cost = genCostCents(spec.durationSeconds, usdPerSecond)
    const marginMultiple = spec.minAmountCents / cost
    return {
      tier,
      durationSeconds: spec.durationSeconds,
      minAmountCents: spec.minAmountCents,
      genCostCents: cost,
      marginMultiple,
      ok: spec.minAmountCents > cost * MIN_MARGIN_MULTIPLE,
    }
  })
}

/** Throws unless every tier clears the 3x margin. Called at boot. */
export function assertEconomics(usdPerSecond: number): void {
  const bad = economicsReport(usdPerSecond).filter((r) => !r.ok)
  if (bad.length === 0) return
  const lines = bad.map(
    (r) =>
      `  tier ${r.tier}: min $${(r.minAmountCents / 100).toFixed(2)} vs gen cost ` +
      `$${(r.genCostCents / 100).toFixed(2)} (${r.marginMultiple.toFixed(2)}x, need >${MIN_MARGIN_MULTIPLE}x)`,
  )
  throw new Error(
    `Economics guardrail failed at $${usdPerSecond}/generated second:\n${lines.join('\n')}`,
  )
}

/** Validates a submitted bid against tier floors. Returns an error string or null. */
export function validateBidAmount(
  tier: Tier,
  amountCents: number,
  opts: { hasImage?: boolean; surgeMultiplier?: number } = {},
): string | null {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return 'amount_cents must be a positive integer'
  }
  const floor = floorPriceCents(tier, opts)
  if (amountCents < floor) {
    return `tier ${tier} needs at least $${(floor / 100).toFixed(2)} right now`
  }
  return null
}

export function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}
