import type { Metadata } from 'next'
import './globals.css'
import { Providers } from './providers'
import { ClientLayout } from '@/components/layout/client-layout'

export const metadata: Metadata = {
  title: 'Nyx ERP',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body>
        <Providers>
          <ClientLayout>{children}</ClientLayout>
        </Providers>
      </body>
    </html>
  )
}
