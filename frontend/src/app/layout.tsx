import type { Metadata, Viewport } from 'next'
import { headers } from 'next/headers'
import { AppToaster } from '@/components/app-toaster'
import { MascotOverlay } from '@/components/mascot-overlay'
import { SiteChrome } from '@/components/site-chrome'
import { SiteFooter } from '@/components/site-footer'
import { ThemeHydrator } from '@/components/theme-hydrator'
import { getThemeInitScript } from '@/lib/theme'
import './globals.css'

export const metadata: Metadata = {
  title: 'Progyx',
  description: 'Progyx — обучающая платформа для школьников по программированию',
  icons: {
    icon: '/tab-icon.png',
    shortcut: '/tab-icon.png',
    apple: '/tab-icon.png',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const headersList = await headers()
  const nonce = headersList.get('x-nonce') ?? ''

  return (
    <html lang="ru" data-theme="light" suppressHydrationWarning>
      <head>
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: getThemeInitScript() }}
        />
      </head>
      <body>
        <ThemeHydrator />
        <AppToaster />
        <MascotOverlay />
        <SiteChrome />
        {children}
        <SiteFooter />
      </body>
    </html>
  )
}
