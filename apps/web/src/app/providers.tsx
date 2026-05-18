'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { useState } from 'react'
import { AuthProvider } from '@/lib/auth-context'
import { ToastProvider } from '@/lib/toast-context'
import { Toaster } from '@/components/ui/toast'

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider defaultPosition="bottom-right" defaultPositionMobile="bottom-center">
          <AuthProvider>
            {children}
          </AuthProvider>
          <Toaster />
        </ToastProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
