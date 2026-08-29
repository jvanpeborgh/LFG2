import { NextResponse } from 'next/server'
import { getStreamState } from '@/lib/state'
import { heartbeat } from '@/lib/viewers'

export const dynamic = 'force-dynamic'

/**
 * HUD state + viewer heartbeat in one call (§8 `/`). The `v` param is an
 * opaque per-tab id used only to count concurrent viewers.
 */
export async function GET(request: Request) {
  const viewerId = new URL(request.url).searchParams.get('v')
  if (viewerId) heartbeat(viewerId)

  const state = await getStreamState()
  return NextResponse.json(state, {
    headers: { 'cache-control': 'no-store, max-age=0' },
  })
}
