'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { login } from '@/lib/auth'
import { portalLogin } from '@/lib/portal-auth'
import { Button } from '@/components/ui/button'
import { PasswordInput } from '@/components/ui/password-input'
import { cn } from '@/lib/utils'

// One login, two accesses: Gestão (the staff system, username + password) and Operador (the crew
// portal, matrícula + PIN). The last one chosen is remembered on the device; ?acesso=operador
// opens straight on the portal's (a link the empresas can hand out).

type Access = 'gestao' | 'operador'
const ACCESS_KEY = 'nyx.login.access'

const inputClass = 'w-full rounded-(--radius) border border-input bg-input-bg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'

export default function LoginPage() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const queryClient  = useQueryClient()
  const [access,     setAccess]     = useState<Access>('gestao')
  const [username,   setUsername]   = useState('')
  const [password,   setPassword]   = useState('')
  const [persistent, setPersistent] = useState(true)
  const [code,       setCode]       = useState('')
  const [pin,        setPin]        = useState('')
  const [error,      setError]      = useState('')
  const [loading,    setLoading]    = useState(false)

  // the link's access, else the last one used
  useEffect(() => {
    const asked = searchParams.get('acesso')
    let last: string | null = null
    try { last = localStorage.getItem(ACCESS_KEY) } catch { /* private mode */ }
    const pick = asked === 'operador' || asked === 'gestao' ? asked : last === 'operador' ? 'operador' : 'gestao'
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAccess(pick)
  }, [searchParams])

  function choose(next: Access) {
    setAccess(next)
    setError('')
    try { localStorage.setItem(ACCESS_KEY, next) } catch { /* private mode */ }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (access === 'gestao') {
        await login(username, password, persistent)
        await queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
        router.push('/')
      } else {
        await portalLogin(code.trim(), pin)
        router.push('/portal')
      }
    } catch (err) {
      setError(access === 'gestao' ? 'Usuário ou senha inválidos.' : err instanceof Error ? err.message : 'Matrícula ou PIN inválido.')
    } finally {
      setLoading(false)
    }
  }

  const operador = access === 'operador'

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
            <div className="flex items-start gap-3">
              <div className="space-y-1 me-auto">
                <h1 className="text-lg font-semibold text-card-foreground">Entrar</h1>
                <p className="text-sm text-muted-foreground">{operador ? 'Sua escala e seus pedidos' : 'Acesse sua conta para continuar'}</p>
              </div>
              <div role="tablist" aria-label="Tipo de acesso" className="inline-flex h-[30px] shrink-0 rounded-sm border border-border p-0.5 bg-background/50">
                {(['gestao', 'operador'] as const).map(a => (
                  <button
                    key={a} type="button" role="tab" aria-selected={access === a} onClick={() => choose(a)}
                    className={cn('px-3 text-xs rounded-sm transition-colors cursor-pointer',
                      access === a ? 'bg-accent text-accent-foreground font-medium' : 'text-muted-foreground hover:text-foreground')}
                  >
                    {a === 'gestao' ? 'Gestão' : 'Operador'}
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-(--radius) px-3 py-2">
                {error}
              </p>
            )}

            {operador ? (
              <form key="operador" onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-card-foreground">Matrícula</label>
                  <input
                    type="text" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)}
                    required autoFocus placeholder="Sua matrícula" className={inputClass}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-card-foreground">PIN</label>
                  <PasswordInput
                    value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    required inputMode="numeric" autoComplete="current-password" pattern="\d{6}" maxLength={6}
                    placeholder="6 dígitos" className="w-full"
                  />
                  <p className="text-xs text-muted-foreground">Primeiro acesso: os 6 primeiros dígitos do seu CPF.</p>
                </div>

                <Button type="submit" disabled={loading || pin.length !== 6} className="w-full" size="default">
                  {loading ? 'Entrando…' : 'Entrar'}
                </Button>
              </form>
            ) : (
              <form key="gestao" onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
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
                    className={inputClass}
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

                  <Link
                    href="/login/forgot-password"
                    className="text-sm text-primary hover:underline"
                  >
                    Recuperar senha
                  </Link>
                </div>

                <Button type="submit" disabled={loading} className="w-full" size="default">
                  {loading ? 'Entrando…' : 'Entrar'}
                </Button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
