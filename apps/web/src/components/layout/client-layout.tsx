'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { AppLayout } from './app-layout'

const AUTH_PATHS = ['/login']

export function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [mounted, setMounted] = useState(false)
  
  useEffect(() => {
    setMounted(true)
  }, [])
  
  // Avoid hydration mismatch by not rendering layout until client is mounted
  if (!mounted) {
    return <>{children}</>
  }
  
  const isAuth = AUTH_PATHS.some((p) => pathname.startsWith(p))
  if (isAuth) return <>{children}</>
  return <AppLayout>{children}</AppLayout>
}
