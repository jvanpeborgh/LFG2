import { NextResponse } from 'next/server'
import { isDatabaseConfigured, query } from '@/lib/db'
import { env } from '@/lib/env'
import { economicsReport } from '@/lib/tiers'

export const dynamic = 'force-dynamic'

export async function GET() {
  const economics = economicsReport(env().GEN_COST_USD_PER_SEC)
  const economicsOk = economics.every((row) => row.ok)

  let db: 'up' | 'down' | 'unset' = 'unset'
  if (isDatabaseConfigured()) {
    try {
      await query('select 1')
      db = 'up'
    } catch {
      db = 'down'
    }
  }

  const ok = economicsOk && db !== 'down'
  return NextResponse.json(
    {
      ok,
      db,
      economics,
      simulcastSafe: env().SIMULCAST_SAFE,
      version: process.env.npm_package_version ?? '0.1.0',
    },
    { status: ok ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  )
}
