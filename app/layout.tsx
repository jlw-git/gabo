import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

// Inter: humanist sans-serif with generous x-height and distinct character
// forms (0/O, 1/l/I) — meets WCAG readability guidance at our body sizes.
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Gabo — less planning, more us time',
  description: 'Find dinner and things to do in Singapore, with your tastes and both journeys in mind. Build a shortlist and share your next date idea.',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#f8f5ef',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`h-full antialiased ${inter.variable}`}>
      <body className="min-h-full flex flex-col bg-background text-stone-900">{children}</body>
    </html>
  )
}
