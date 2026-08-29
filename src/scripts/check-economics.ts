#!/usr/bin/env tsx
/** §9 guardrail as a standalone check: `npm run check:economics`. */
import { loadEnvFile } from '../lib/load-env'
import { env } from '../lib/env'
import { assertEconomics, economicsReport, formatUsd } from '../lib/tiers'

loadEnvFile()
const rate = env().GEN_COST_USD_PER_SEC

console.log(`generation cost: $${rate.toFixed(3)}/second\n`)
console.log('tier  airtime   floor      gen cost   margin')
for (const row of economicsReport(rate)) {
  console.log(
    `  ${row.tier}   ${String(row.durationSeconds).padStart(2)}s      ` +
      `${formatUsd(row.minAmountCents).padEnd(9)} ${formatUsd(row.genCostCents).padEnd(10)} ` +
      `${row.marginMultiple.toFixed(1)}x ${row.ok ? 'ok' : 'FAIL'}`,
  )
}

try {
  assertEconomics(rate)
  console.log('\nall tiers clear the 3x guardrail')
} catch (err) {
  console.error(`\n${(err as Error).message}`)
  process.exitCode = 1
}
