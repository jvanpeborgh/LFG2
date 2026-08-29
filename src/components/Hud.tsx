'use client'

import { useEffect, useState } from 'react'
import type { StreamState } from '@/lib/state'
import { formatUsd, TIER_ORDER, TIERS } from '@/lib/tiers'

interface HudProps {
  initial: StreamState
  qrDataUrl: string | null
  bidUrl: string
}

const POLL_MS = 3000

/**
 * Client-side HUD (§7: not burned into the stream). Polls /api/state, which
 * doubles as the viewer heartbeat. M2 swaps the poll for SSE without changing
 * this component's shape.
 */
export default function Hud({ initial, qrDataUrl, bidUrl }: HudProps) {
  const [state, setState] = useState<StreamState>(initial)

  useEffect(() => {
    const viewerId = getViewerId()
    let cancelled = false

    const tick = async () => {
      try {
        const res = await fetch(`/api/state?v=${encodeURIComponent(viewerId)}`, {
          cache: 'no-store',
        })
        if (!res.ok) return
        const next = (await res.json()) as StreamState
        if (!cancelled) setState(next)
      } catch {
        // Keep the last good state on screen rather than blanking the HUD.
      }
    }

    void tick()
    const id = setInterval(tick, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const now = state.nowPlaying

  return (
    <div className="hud">
      <div className="row">
        <div className="brand">
          BIDSTREAM
          <span className="live">LIVE</span>
        </div>
        <div className="stat">
          <span>
            <b>{state.viewers}</b> watching
          </span>
          <span>
            <b>{state.queueDepth}</b> in queue
          </span>
          <span>
            <b>{state.archiveCount}</b> clips aired
          </span>
          {state.surgeMultiplier > 1 && (
            <span className="surge">SURGE ×{state.surgeMultiplier.toFixed(2)}</span>
          )}
          {state.degraded && <span className="degraded">STANDBY DATA</span>}
        </div>
      </div>

      <div className="row">
        <div />
        <div className="rail">
          <h2>
            <span>UP NEXT</span>
            <span>{formatWait(state.backlogSeconds)}</span>
          </h2>
          {state.queue.length === 0 && (
            <p className="empty">
              Queue is empty — the channel is replaying paid clips, weighted by what
              they paid. Bid and you air next.
            </p>
          )}
          {state.queue.map((entry) => (
            <div className="qitem" key={entry.bidId}>
              <span className="pos">{entry.position}</span>
              <span>
                <span className="who">@{entry.handle}</span>
                <span className="prompt">{entry.prompt}</span>
              </span>
              <span className="amt">
                {formatUsd(entry.amountCents)}
                <br />
                <span className="pos">{formatWait(entry.etaSeconds ?? 0)}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="lower">
        <div className="card">
          <div className="kicker">
            {now ? `NOW AIRING · ${now.kind.toUpperCase()}` : 'STANDBY'}
          </div>
          <div className="title">
            {now?.handle ? (
              <>
                @{now.handle} <span className="amt">{formatUsd(now.amountCents ?? 0)}</span>
              </>
            ) : (
              'house clip'
            )}
          </div>
          <div className="promptline">
            {now?.prompt ?? 'Nothing paid is airing. Bid to take the channel.'}
          </div>
        </div>

        <div className="cta">
          <div>
            <div className="floors">
              {TIER_ORDER.map((tier) => (
                <span key={tier}>
                  {tier} · {TIERS[tier].durationSeconds}s{' '}
                  <b>{formatUsd(state.floors[tier])}</b>
                </span>
              ))}
            </div>
            <div style={{ marginTop: 10 }}>
              <a className="bidbtn" href={bidUrl}>
                BID TO AIR
              </a>
            </div>
          </div>
          {qrDataUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="qr" src={qrDataUrl} alt={`QR code to ${bidUrl}`} />
          )}
        </div>
      </div>
    </div>
  )
}

function formatWait(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'now'
  if (seconds < 60) return `${Math.round(seconds)}s`
  const mins = Math.floor(seconds / 60)
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}`
}

function getViewerId(): string {
  const key = 'bidstream:viewer'
  try {
    const existing = sessionStorage.getItem(key)
    if (existing) return existing
    const id = crypto.randomUUID()
    sessionStorage.setItem(key, id)
    return id
  } catch {
    return Math.random().toString(36).slice(2)
  }
}
