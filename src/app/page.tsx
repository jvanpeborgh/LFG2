import QRCode from 'qrcode'
import Hud from '@/components/Hud'
import Player from '@/components/Player'
import { publicConfig } from '@/lib/env'
import { getStreamState } from '@/lib/state'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const state = await getStreamState()
  const bidUrl = `${publicConfig.siteUrl.replace(/\/$/, '')}/bid`

  const qrDataUrl = await QRCode.toDataURL(bidUrl, {
    margin: 0,
    width: 256,
    errorCorrectionLevel: 'M',
  }).catch(() => null)

  return (
    <main className="stage">
      <Player hlsUrl={publicConfig.hlsUrl} fallbackMp4={publicConfig.fallbackMp4} />
      <Hud initial={state} qrDataUrl={qrDataUrl} bidUrl="/bid" />
    </main>
  )
}
