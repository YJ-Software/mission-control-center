import type { Metadata, Viewport } from 'next'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages } from 'next-intl/server'
import '@fontsource-variable/outfit'
import '@fontsource-variable/jetbrains-mono'
import './globals.css'

export const metadata: Metadata = {
  title: 'Mission Control — OpenClaw',
  description: 'OpenClaw Mission Control Dashboard',
  icons: { icon: '/favicon.svg' },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()
  const messages = await getMessages()

  // suppressHydrationWarning: some mobile browsers / extensions inject attributes
  // (e.g. __gcrremoteframetoken) onto <html>/<body> before React hydrates, which
  // would otherwise trip a hydration mismatch warning.
  return (
    <html lang={locale} className="dark" suppressHydrationWarning>
      <body className="font-sans" suppressHydrationWarning>
        <NextIntlClientProvider messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
