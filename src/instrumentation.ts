/**
 * Next.js boot hook. Runs once per server process, before any request.
 * §9: the economics guardrail is asserted at boot — if a tier floor stops
 * covering 3x its generation cost, the app refuses to start rather than
 * quietly losing money on every bid.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { assertEconomics } = await import('./lib/tiers')
  const { env } = await import('./lib/env')
  assertEconomics(env().GEN_COST_USD_PER_SEC)
}
