import type { Metadata } from 'next'
import './globals.css'
import { Providers } from './providers'
import { ClientLayout } from '@/components/layout/client-layout'

export const metadata: Metadata = {
  title: 'Nyx ERP',
  icons: {
    icon: '/favicon.ico',
  }
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Providers>
          <ClientLayout>{children}</ClientLayout>
        </Providers>
      </body>
    </html>
  )
}
