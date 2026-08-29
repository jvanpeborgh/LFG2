/**
 * Viewer presence, in memory.
 *
 * The player heartbeats with a per-tab id; anything not seen inside the TTL is
 * dropped. In-process only, which is correct for v1 (single long-running app
 * next to the broadcaster, §3) and will need Redis the day there is a second
 * app instance.
 */

const TTL_MS = 30_000

declare global {
  // eslint-disable-next-line no-var
  var __bidstreamViewers: Map<string, number> | undefined
}

function registry(): Map<string, number> {
  if (!globalThis.__bidstreamViewers) globalThis.__bidstreamViewers = new Map()
  return globalThis.__bidstreamViewers
}

function prune(now: number): void {
  const reg = registry()
  for (const [id, lastSeen] of reg) {
    if (now - lastSeen > TTL_MS) reg.delete(id)
  }
}

export function heartbeat(viewerId: string): void {
  if (!viewerId) return
  const now = Date.now()
  registry().set(viewerId.slice(0, 64), now)
  prune(now)
}

export function viewerCount(): number {
  const now = Date.now()
  prune(now)
  return registry().size
}
