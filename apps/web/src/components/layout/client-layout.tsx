'use client'

import { usePathname } from 'next/navigation'
import { AppLayout } from './app-layout'

const AUTH_PATHS = ['/login']

export function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isAuth = AUTH_PATHS.some((p) => pathname.startsWith(p))
  if (isAuth) return <>{children}</>
  return <AppLayout>{children}</AppLayout>
}
