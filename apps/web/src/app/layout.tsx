import type { Metadata } from 'next'
import './globals.css'
import { Providers } from './providers'
import { ClientLayout } from '@/components/layout/client-layout'

// every page sits behind client-side auth, so nothing is worth prerendering at build time;
// static generation also fails on pages reading useSearchParams outside a Suspense boundary
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Nyx ERP',
  icons: {
    icon: '/favicon.ico',
  }
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="dark theme-slate" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Providers>
          <ClientLayout>{children}</ClientLayout>
        </Providers>
      </body>
    </html>
  )
}
