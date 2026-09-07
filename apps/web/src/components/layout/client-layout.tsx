'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { AppLayout } from './app-layout'

const AUTH_PATHS = ['/login']

export function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [mounted, setMounted] = useState(false)
  
  // Hydration-mount guard — can only be known client-side, after commit.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
