'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { login } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { PasswordInput } from '@/components/ui/password-input'

export default function LoginPage() {
  const router      = useRouter()
  const queryClient = useQueryClient()
  const [username,   setUsername]   = useState('')
  const [password,   setPassword]   = useState('')
  const [persistent, setPersistent] = useState(true)
  const [error,      setError]      = useState('')
  const [loading,    setLoading]    = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(username, password, persistent)
      await queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
      router.push('/')
    } catch {
      setError('Usuário ou senha inválidos.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex">

      {/* Painel do formulário */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 bg-background">
        {/* Logo mobile */}
        <div className="flex flex-col items-center gap-1 mb-2">
          <span className="text-2xl font-bold tracking-tight text-cyan-800">nyx</span>
        </div>

        <div className="w-full max-w-sm">
          <div
            className="rounded-(--radius) border border-border bg-card p-8 shadow-sm space-y-5"
          >
            <div className="space-y-1">
              <h1 className="text-lg font-semibold text-card-foreground">Entrar</h1>
              <p className="text-sm text-muted-foreground">Acesse sua conta para continuar</p>
            </div>

            {error && (
              <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-(--radius) px-3 py-2">
                {error}
              </p>
            )}

            <form onSubmit={handleSubmit} className="space-y-4" autoComplete='off'>
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-card-foreground">
                  Usuário
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoFocus
                  placeholder="Username"
                  className="w-full rounded-(--radius) border border-input bg-input-bg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-card-foreground">
                  Senha
                </label>
                <PasswordInput
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="Digite sua senha"
                  className="w-full"
                />
              </div>

              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={persistent}
                    onChange={(e) => setPersistent(e.target.checked)}
                    className="cursor-pointer"
                  />
                  <span className="text-sm text-muted-foreground">Permanecer conectado</span>
                </label>

                <a
                  href="/login/forgot-password"
                  className="text-sm text-primary hover:underline"
                >
                  Recuperar senha
                </a>
              </div>

              <Button type="submit" disabled={loading} className="w-full" size="default">
                {loading ? 'Entrando…' : 'Entrar'}
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
