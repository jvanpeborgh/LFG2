import { query, isDatabaseConfigured } from './db'

/** Append-only event log (§4). Types are open-ended by design. */
export type EventType =
  | 'bid_created'
  | 'paid'
  | 'topped_up'
  | 'approved'
  | 'rejected'
  | 'generation_started'
  | 'generated'
  | 'generation_failed'
  | 'aired'
  | 'refunded'
  | 'queue_paused'
  | 'broadcaster_fallback'

export interface EventInput {
  bidId?: string | null
  clipId?: string | null
  data?: Record<string, unknown>
}

/**
 * Never throws: losing an audit line must not take down a payment or the
 * broadcaster. Failures are logged loudly instead.
 */
export async function recordEvent(type: EventType, input: EventInput = {}): Promise<void> {
  const payload = {
    type,
    bidId: input.bidId ?? null,
    clipId: input.clipId ?? null,
    data: input.data ?? {},
  }
  if (!isDatabaseConfigured()) {
    console.log('[event]', JSON.stringify(payload))
    return
  }
  try {
    await query(
      'insert into events (type, bid_id, clip_id, data) values ($1, $2, $3, $4)',
      [payload.type, payload.bidId, payload.clipId, JSON.stringify(payload.data)],
    )
  } catch (err) {
    console.error('[event] failed to persist', payload, err)
  }
}
