'use client'

import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { Save, Check, ArrowLeft } from 'lucide-react'
import { useTopbarActions } from '@/components/layout/topbar-actions-context'
import { useShortcut } from '@/lib/keywatch'
import { apiFetch } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { useDiscovery } from '@/core/useDiscovery'
import { Breadcrumb } from '@/components/ui/breadcrumb'
import type { PasswordPolicy } from '@nyx/schemas'

// ─── Switch ──────────────────────────────────────────────────────────────────

function Switch({ checked, onToggle }: { checked: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onToggle}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent',
        'transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        checked ? 'bg-primary' : 'bg-input',
      )}
    >
      <span className={cn(
        'pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform duration-150',
        checked ? 'translate-x-4' : 'translate-x-0',
      )} />
    </button>
  )
}

// ─── Stepper ─────────────────────────────────────────────────────────────────

function Stepper({ value, onChange, min = 0, max }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number
}) {
  const clamp = (n: number) => max !== undefined ? Math.min(max, Math.max(min, n)) : Math.max(min, n)
  return (
    <div className="flex items-center">
      <button type="button" onClick={() => onChange(clamp(value - 1))}
        className="flex h-8 w-8 items-center justify-center rounded-l-md border border-input bg-background text-sm font-medium hover:bg-muted transition-colors select-none"
      >−</button>
      <input
        type="number" value={value} min={min} max={max}
        onChange={(e) => onChange(clamp(parseInt(e.target.value, 10) || min))}
        className="h-8 w-16 border-y border-input bg-background text-center text-sm focus:outline-none focus:ring-1 focus:ring-ring [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      <button type="button" onClick={() => onChange(clamp(value + 1))}
        className="flex h-8 w-8 items-center justify-center rounded-r-md border border-input bg-background text-sm font-medium hover:bg-muted transition-colors select-none"
      >+</button>
    </div>
  )
}

// ─── PolicyPreview ───────────────────────────────────────────────────────────

function PolicyPreview({ values }: { values: PasswordPolicyValues }) {
  const items = [
    { active: true,                     label: `Mínimo ${values.minLength} caractere${values.minLength !== 1 ? 's' : ''}` },
    { active: values.requireUppercase,  label: 'Letras maiúsculas obrigatórias' },
    { active: values.requireNumbers,    label: 'Números obrigatórios' },
    { active: values.requireSpecial,    label: 'Caracteres especiais obrigatórios' },
    { active: values.historyCount > 0,  label: `Não repetir as últimas ${values.historyCount} senha${values.historyCount !== 1 ? 's' : ''}` },
    { active: values.expiresInDays > 0, label: `Expira a cada ${values.expiresInDays} dia${values.expiresInDays !== 1 ? 's' : ''}` },
  ]
  const active   = items.filter((i) => i.active)
  const inactive = items.filter((i) => !i.active)

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-5 h-fit sticky top-6">
      <p className="text-sm font-medium mb-4">Prévia</p>
      <div className="flex flex-col gap-2.5">
        {active.map((item) => (
          <div key={item.label} className="flex items-center gap-2.5 text-sm text-foreground">
            <Check className="h-4 w-4 shrink-0 text-emerald-500" />
            {item.label}
          </div>
        ))}
        {active.length > 0 && inactive.length > 0 && <div className="border-t border-border my-0.5" />}
        {inactive.map((item) => (
          <div key={item.label} className="flex items-center gap-2.5 text-sm text-muted-foreground/40">
            <Check className="h-4 w-4 shrink-0 opacity-20" />
            {item.label}
          </div>
        ))}
      </div>
      {active.length <= 1 && (
        <p className="mt-4 text-xs text-muted-foreground">Ative mais critérios para aumentar a segurança.</p>
      )}
    </div>
  )
}

// ─── PasswordPolicySection ───────────────────────────────────────────────────

interface PasswordPolicyValues {
  minLength: number; requireUppercase: boolean; requireNumbers: boolean
  requireSpecial: boolean; historyCount: number; expiresInDays: number
}

const PP_DEFAULTS: PasswordPolicyValues = {
  minLength: 8, requireUppercase: false, requireNumbers: false,
  requireSpecial: false, historyCount: 0, expiresInDays: 0,
}

function PasswordPolicySection({ onFormReady }: { onFormReady: (submit: () => Promise<void>) => void }) {
  const queryClient = useQueryClient()

  const { data: policy } = useQuery<PasswordPolicy | null>({
    queryKey: ['settings', 'password-policy'],
    queryFn:  async () => {
      const res = await apiFetch('/core/password-policy')
      if (!res.ok) return null
      return (await res.json()) ?? null
    },
  })

  const { setValue, handleSubmit, watch, reset } = useForm<PasswordPolicyValues>({ defaultValues: PP_DEFAULTS })
  const values = watch()

  useEffect(() => {
    if (policy) reset({ ...PP_DEFAULTS, ...policy })
  }, [policy]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    onFormReady(handleSubmit(async (data) => {
      await apiFetch('/core/password-policy', { method: 'PUT', body: JSON.stringify(data) })
      queryClient.invalidateQueries({ queryKey: ['settings', 'password-policy'] })
    }) as () => Promise<void>)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const labelCls = 'text-sm font-medium'
  const hintCls  = 'text-xs text-muted-foreground mt-0.5'
  const cardCls  = 'rounded-lg border border-border divide-y divide-border'
  const rowCls   = 'flex items-center justify-between gap-6 px-4 py-3'

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-6 items-start">
      <div className="flex flex-col gap-5">

        <section>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Comprimento</p>
          <div className={cardCls}>
            <div className={rowCls}>
              <div>
                <p className={labelCls}>Comprimento mínimo</p>
                <p className={hintCls}>Número mínimo de caracteres exigidos na senha</p>
              </div>
              <Stepper value={values.minLength} onChange={(v) => setValue('minLength', v)} min={1} max={128} />
            </div>
          </div>
        </section>

        <section>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Complexidade</p>
          <div className={cardCls}>
            {([
              { field: 'requireUppercase' as const, label: 'Letras maiúsculas',    hint: 'Exige ao menos uma letra maiúscula (A–Z)' },
              { field: 'requireNumbers'   as const, label: 'Números',              hint: 'Exige ao menos um dígito (0–9)' },
              { field: 'requireSpecial'   as const, label: 'Caracteres especiais', hint: 'Exige ao menos um símbolo (!@#$…)' },
            ]).map(({ field, label, hint }) => (
              <div key={field} className={rowCls}>
                <div>
                  <p className={labelCls}>{label}</p>
                  <p className={hintCls}>{hint}</p>
                </div>
                <Switch checked={values[field]} onToggle={() => setValue(field, !values[field])} />
              </div>
            ))}
          </div>
        </section>

        <section>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Histórico e expiração</p>
          <div className={cardCls}>
            <div className={rowCls}>
              <div>
                <p className={labelCls}>Histórico de senhas</p>
                <p className={hintCls}>Impede reutilização das últimas N senhas. 0 = desativado</p>
              </div>
              <Stepper value={values.historyCount} onChange={(v) => setValue('historyCount', v)} min={0} max={24} />
            </div>
            <div className={rowCls}>
              <div>
                <p className={labelCls}>Expiração (dias)</p>
                <p className={hintCls}>Força troca de senha após N dias. 0 = não expira</p>
              </div>
              <Stepper value={values.expiresInDays} onChange={(v) => setValue('expiresInDays', v)} min={0} />
            </div>
          </div>
        </section>

      </div>
      <PolicyPreview values={values} />
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

// Cada seção registra aqui seu handler de save; o botão do topbar chama todos.
const sectionSavers: Array<() => Promise<void>> = []

export default function SettingsPage() {
  const router = useRouter()
  const { data: domains } = useDiscovery()
  const domainLabel = domains?.find((d) => d.key === 'core')?.label ?? 'Core'

  function registerSaver(index: number) {
    return (fn: () => Promise<void>) => { sectionSavers[index] = fn }
  }

  async function saveAll() {
    await Promise.all(sectionSavers.map((fn) => fn?.()))
  }

  function goBack() { router.push('/core') }

  useTopbarActions([
    { label: 'Gravar', icon: Save, onClick: saveAll, primary: true, keybind: 'Alt+G' },
  ])

  useShortcut('alt+v', goBack, {
    desc:   'Voltar',
    icon:   ArrowLeft,
    origin: 'apps/web/src/app/core/settings/page',
  })

  useShortcut('alt+g', saveAll, {
    desc:   'Salvar configurações',
    icon: Save,
    origin: 'apps/web/src/app/core/settings/page',
  })

  return (
    <div className="p-6 max-w-4xl flex flex-col gap-10">
      <Breadcrumb segments={[
        { label: 'Início',          href: '/' },
        { label: domainLabel,       href: '/core' },
        { label: 'Configurações' },
      ]} />

      {/* ── Política de Senha ── */}
      <section>
        <div className="mb-5 pb-3 border-b border-border">
          <h2 className="text-base font-semibold">Política de Senha</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Regras de complexidade, histórico e expiração aplicadas a todos os usuários.
          </p>
        </div>
        <PasswordPolicySection onFormReady={registerSaver(0)} />
      </section>

      {/* Novas seções de configuração serão adicionadas aqui */}

    </div>
  )
}
