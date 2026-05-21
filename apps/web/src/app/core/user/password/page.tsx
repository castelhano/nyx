'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Save, ArrowLeft, KeyRound, Check } from 'lucide-react'
import { Breadcrumb } from '@/components/ui/breadcrumb'
import { useTopbarActions } from '@/components/layout/topbar-actions-context'
import { useShortcut } from '@/lib/keywatch'
import { useAuth } from '@/lib/auth-context'
import { useToast } from '@/lib/toast-context'
import { PasswordInput } from '@/components/ui/password-input'
import { apiFetch } from '@/lib/auth'
import { cn } from '@/lib/utils'
import type { PasswordPolicy } from '@nyx/schemas'

const FORM_ID = 'change-password-form'

function extractError(json: Record<string, unknown>): string | string[] {
  const outer = json?.message
  const payload = (outer && typeof outer === 'object' && !Array.isArray(outer))
    ? (outer as Record<string, unknown>)
    : json
  const msg = payload?.message ?? payload
  if (typeof msg === 'string') return msg
  if (Array.isArray(msg))      return msg as string[]
  return 'Erro ao alterar senha.'
}

interface FormValues {
  currentPassword: string
  newPassword:     string
  confirmPassword: string
}

export default function ChangePasswordPage() {
  const router              = useRouter()
  const queryClient         = useQueryClient()
  const { user }            = useAuth()
  const { toast }           = useToast()
  const [isPending, setIsPending]     = useState(false)
  const [serverError, setServerError] = useState<string | string[]>('')

  const { data: policy } = useQuery<PasswordPolicy | null>({
    queryKey: ['core', 'password-policy'],
    queryFn:  async () => {
      const res = await apiFetch('/core/password-policy')
      if (!res.ok) return null
      return res.json() as Promise<PasswordPolicy>
    },
    staleTime: 300_000,
  })

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  })

  const newPasswordValue     = watch('newPassword')
  const confirmPasswordValue = watch('confirmPassword')

  const policyChecks = policy ? [
    { ok: newPasswordValue.length >= policy.minLength,              label: `Mín. ${policy.minLength} caracteres` },
    ...(policy.requireUppercase ? [{ ok: /[A-Z]/.test(newPasswordValue),          label: 'Letra maiúscula' }]  : []),
    ...(policy.requireNumbers   ? [{ ok: /[0-9]/.test(newPasswordValue),          label: 'Número' }]           : []),
    ...(policy.requireSpecial   ? [{ ok: /[^A-Za-z0-9]/.test(newPasswordValue),   label: 'Símbolo especial' }] : []),
    { ok: !!newPasswordValue && newPasswordValue === confirmPasswordValue, label: 'Senhas coincidem' },
  ] : []

  async function onSubmit(values: FormValues) {
    if (!user) return
    setServerError('')
    setIsPending(true)
    const res = await apiFetch(`/core/user/${user.id}/change-password`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: values.currentPassword,
        newPassword:     values.newPassword,
      }),
    }).catch(() => null)
    if (!res || !res.ok) {
      const json = await res?.json().catch(() => ({})) ?? {}
      setServerError(extractError(json))
      setIsPending(false)
      return
    }
    await queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
    toast.success('Senha alterada com sucesso')
    router.push('/')
  }

  useTopbarActions(
    [{ label: isPending ? 'Gravando…' : 'Gravar', icon: Save, type: 'submit', form: FORM_ID, disabled: isPending, primary: true, keybind: 'ALT+G' }],
    [isPending],
  )

  useShortcut('alt+g', () => {
    (document.getElementById(FORM_ID) as HTMLFormElement | null)?.requestSubmit()
  }, { desc: 'Salvar senha', icon: Save, context: 'all', origin: 'user/password/page' })

  useShortcut('alt+v', () => router.push('/'), {
    desc: 'Voltar', icon: ArrowLeft, context: 'all', origin: 'user/password/page',
  })

  return (
    <div className="p-6 flex flex-col gap-8">
      <Breadcrumb segments={[{ label: 'Início', href: '/' }, { label: 'Alterar Senha' }]} />

      <div className="flex gap-6 items-start">
        <form id={FORM_ID} onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6 w-full max-w-sm">

          <section className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-muted-foreground" />
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Alterar Senha</p>
            </div>

            <div className="rounded-lg border border-border bg-card divide-y divide-border">

              <div className="flex flex-col gap-1.5 px-4 py-3">
                <label className="text-sm font-medium">Senha atual</label>
                <PasswordInput
                  placeholder="Digite sua senha atual"
                  error={errors.currentPassword?.message}
                  {...register('currentPassword', { required: 'Informe a senha atual' })}
                />
              </div>

              <div className="flex flex-col gap-1.5 px-4 py-3">
                <label className="text-sm font-medium">Nova senha</label>
                <PasswordInput
                  placeholder="Nova senha"
                  error={errors.newPassword?.message}
                  {...register('newPassword', { required: 'Informe a nova senha' })}
                />
              </div>

              <div className="flex flex-col gap-1.5 px-4 py-3">
                <label className="text-sm font-medium">Confirmar nova senha</label>
                <PasswordInput
                  placeholder="Repita a nova senha"
                  error={errors.confirmPassword?.message}
                  {...register('confirmPassword', {
                    required: 'Confirme a nova senha',
                    validate: (v) => v === newPasswordValue || 'As senhas não coincidem',
                  })}
                />
              </div>

            </div>
          </section>

          {serverError && (
            <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2 flex flex-col gap-0.5">
              {(Array.isArray(serverError) ? serverError : [serverError]).map((msg, i) => (
                <p key={i}>{msg}</p>
              ))}
            </div>
          )}

        </form>

        {policyChecks.length > 0 && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-muted-foreground" />
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Critérios</p>
            </div>
            <div className="rounded-lg border border-border bg-card divide-y divide-border">
              {policyChecks.map((c) => (
                <div key={c.label} className="flex items-center gap-2.5 px-4 py-2.5">
                  <Check className={cn(
                    'w-3.5 h-3.5 shrink-0 transition-colors',
                    c.ok ? 'text-emerald-500' : 'text-muted-foreground opacity-30',
                  )} />
                  <span className={cn('text-sm transition-colors', c.ok ? 'text-foreground' : 'text-muted-foreground')}>
                    {c.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
