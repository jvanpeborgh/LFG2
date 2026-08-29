import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'BIDSTREAM — bid to air',
  description:
    'A perpetual AI-generated livestream. Bid to air your prompt. Highest price-per-second airs next.',
  openGraph: {
    title: 'BIDSTREAM',
    description: 'Bid to air your prompt on a channel that never stops.',
    type: 'website',
  },
}

export const viewport: Viewport = {
  themeColor: '#000000',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
