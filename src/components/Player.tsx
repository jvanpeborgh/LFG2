'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface PlayerProps {
  hlsUrl: string
  fallbackMp4: string
}

type Source = 'hls' | 'fallback'

/**
 * The real player, used from M0 on. It prefers the broadcaster's HLS playlist
 * and drops to the looping fallback mp4 whenever that playlist is missing or
 * errors — "dead air is the only unacceptable state" (§7) applies on the
 * client too, not just in the broadcaster.
 */
export default function Player({ hlsUrl, fallbackMp4 }: PlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const sourceRef = useRef<Source>('fallback')
  const [source, setSource] = useState<Source>('fallback')
  const [muted, setMuted] = useState(true)

  const setSourceBoth = useCallback((next: Source) => {
    sourceRef.current = next
    setSource(next)
  }, [])

  useEffect(() => {
    let cancelled = false
    let hls: import('hls.js').default | null = null

    const playFallback = (el: HTMLVideoElement) => {
      setSourceBoth('fallback')
      if (!el.src.endsWith(fallbackMp4)) el.src = fallbackMp4
      el.loop = true
      void el.play().catch(() => {})
    }

    const playlistExists = async (): Promise<boolean> => {
      try {
        const res = await fetch(hlsUrl, { method: 'HEAD', cache: 'no-store' })
        return res.ok
      } catch {
        return false
      }
    }

    const attach = async () => {
      const el = videoRef.current
      if (!el) return

      const live = await playlistExists()
      if (cancelled) return
      if (!live) {
        playFallback(el)
        return
      }

      // Safari and iOS play HLS natively; everything else needs hls.js.
      if (el.canPlayType('application/vnd.apple.mpegurl')) {
        el.src = hlsUrl
        el.loop = false
        setSourceBoth('hls')
        void el.play().catch(() => {})
        return
      }

      const HlsMod = (await import('hls.js')).default
      if (cancelled) return
      if (!HlsMod.isSupported()) {
        playFallback(el)
        return
      }

      hls = new HlsMod({ lowLatencyMode: false, backBufferLength: 30 })
      hls.on(HlsMod.Events.ERROR, (_evt, data) => {
        if (!data.fatal) return
        console.warn('[player] fatal hls error, falling back', data.type, data.details)
        hls?.destroy()
        hls = null
        const current = videoRef.current
        if (current) playFallback(current)
      })
      hls.loadSource(hlsUrl)
      hls.attachMedia(el)
      setSourceBoth('hls')
      void el.play().catch(() => {})
    }

    void attach()

    // If the broadcaster comes up later, pick it up without a page reload.
    const retry = setInterval(() => {
      if (cancelled || sourceRef.current === 'hls') return
      void attach()
    }, 15_000)

    return () => {
      cancelled = true
      clearInterval(retry)
      hls?.destroy()
    }
  }, [hlsUrl, fallbackMp4, setSourceBoth])

  return (
    <>
      <video ref={videoRef} autoPlay muted={muted} playsInline preload="auto" />
      <button
        type="button"
        className="soundbtn"
        onClick={() => {
          const el = videoRef.current
          if (!el) return
          const next = !muted
          el.muted = next
          setMuted(next)
          if (!next) void el.play().catch(() => {})
        }}
      >
        {muted ? 'UNMUTE' : 'MUTE'}
        <span className="soundbtn-state">{source === 'hls' ? 'LIVE' : 'STANDBY'}</span>
      </button>
    </>
  )
}
