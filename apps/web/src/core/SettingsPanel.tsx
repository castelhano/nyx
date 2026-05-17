'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { Save, ArrowLeft } from 'lucide-react'
import { useMetadata } from './useMetadata'
import { AutoBreadcrumb } from './AutoBreadcrumb'
import { useTopbarActions } from '@/components/layout/topbar-actions-context'
import { useShortcut } from '@/lib/keywatch'
import { apiFetch } from '@/lib/auth'
import { cn } from '@/lib/utils'
import type { MetadataField } from '@nyx/types'

// ─── Switch ──────────────────────────────────────────────────────────────────

function SettingsSwitch({ checked, onToggle }: { checked: boolean; onToggle: () => void }) {
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

function SettingsStepper({ value, onChange, min = 0, max }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number
}) {
  const clamp = (n: number) => {
    const clamped = Math.max(min, isNaN(n) ? min : n)
    return max !== undefined ? Math.min(max, clamped) : clamped
  }
  return (
    <div className="flex items-center">
      <button type="button" onClick={() => onChange(clamp(value - 1))}
        className="flex h-8 w-8 items-center justify-center rounded-l-md border border-input bg-background text-sm font-medium hover:bg-muted transition-colors select-none"
      >−</button>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(clamp(parseInt(e.target.value, 10)))}
        className="h-8 w-16 border-y border-input bg-background text-center text-sm focus:outline-none focus:ring-1 focus:ring-ring [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      <button type="button" onClick={() => onChange(clamp(value + 1))}
        className="flex h-8 w-8 items-center justify-center rounded-r-md border border-input bg-background text-sm font-medium hover:bg-muted transition-colors select-none"
      >+</button>
    </div>
  )
}

// ─── SettingsField ────────────────────────────────────────────────────────────

function SettingsField({ field, value, onChange }: {
  field:    MetadataField
  value:    unknown
  onChange: (v: unknown) => void
}) {
  const label = (
    <div>
      <p className="text-sm font-medium">{field.label}</p>
      {field.helpText && <p className="text-xs text-muted-foreground mt-0.5">{field.helpText}</p>}
    </div>
  )

  if (field.widget === 'switch' || (field.type === 'boolean' && field.widget !== 'stepper')) {
    return (
      <div className="flex items-center justify-between gap-6 px-4 py-3">
        {label}
        <SettingsSwitch checked={Boolean(value)} onToggle={() => onChange(!value)} />
      </div>
    )
  }

  if (field.widget === 'stepper' || field.type === 'number') {
    return (
      <div className="flex items-center justify-between gap-6 px-4 py-3">
        {label}
        <SettingsStepper
          value={Number(value ?? 0)}
          onChange={onChange}
          min={field.min}
          max={field.max}
        />
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between gap-6 px-4 py-3">
      {label}
      <input
        type="text"
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-48 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
      />
    </div>
  )
}

// ─── SettingsSection ──────────────────────────────────────────────────────────

function SettingsSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">{label}</p>
      <div className="rounded-lg border border-border divide-y divide-border">{children}</div>
    </section>
  )
}

// ─── SettingsPanel ────────────────────────────────────────────────────────────

interface Props {
  domain:   string
  resource: string
}

export function SettingsPanel({ domain, resource }: Props) {
  const router      = useRouter()
  const queryClient = useQueryClient()
  const { data: meta } = useMetadata(domain, resource)

  const FORM_ID = `settings-${domain}-${resource}`

  const { data: serverValues } = useQuery<Record<string, unknown>>({
    queryKey: [domain, resource],
    queryFn:  async () => {
      const res = await apiFetch(`/${domain}/${resource}`)
      if (!res.ok) throw new Error('Failed to fetch settings')
      return res.json()
    },
    enabled: !!meta,
  })

  const { handleSubmit, watch, setValue, reset } = useForm<Record<string, unknown>>({
    defaultValues: {},
  })
  const values = watch()

  useEffect(() => {
    if (serverValues) reset(serverValues)
  }, [serverValues]) // eslint-disable-line react-hooks/exhaustive-deps

  async function onSave(data: Record<string, unknown>) {
    await apiFetch(`/${domain}/${resource}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(data),
    })
    queryClient.invalidateQueries({ queryKey: [domain, resource] })
  }

  useTopbarActions([
    { label: 'Gravar', icon: Save, type: 'submit', form: FORM_ID, primary: true, keybind: 'ALT+G' },
  ])

  useShortcut('alt+g', () => {
    (document.getElementById(FORM_ID) as HTMLFormElement | null)?.requestSubmit()
  }, { desc: 'Salvar configurações', icon: Save, context: 'all', origin: `SettingsPanel/${domain}/${resource}` })

  useShortcut('alt+v', () => router.push(`/${domain}`), {
    desc: 'Voltar', icon: ArrowLeft, context: 'all', origin: `SettingsPanel/${domain}/${resource}`,
  })

  const formFields = meta?.fields.filter((f) => f.showInForm) ?? []
  const groups     = meta?.groups

  return (
    <div className="p-6 max-w-3xl flex flex-col gap-8">
      <AutoBreadcrumb domain={domain} resource={resource} />

      <form id={FORM_ID} onSubmit={handleSubmit(onSave)} className="flex flex-col gap-6">
        {groups ? (
          groups.map((group) => (
            <SettingsSection key={group.label} label={group.label}>
              {group.fields.map((fieldName) => {
                const field = formFields.find((f) => f.name === fieldName)
                if (!field) return null
                return (
                  <SettingsField
                    key={fieldName}
                    field={field}
                    value={values[fieldName]}
                    onChange={(v) => setValue(fieldName, v)}
                  />
                )
              })}
            </SettingsSection>
          ))
        ) : (
          <SettingsSection label={meta?.label ?? resource}>
            {formFields.map((field) => (
              <SettingsField
                key={field.name}
                field={field}
                value={values[field.name]}
                onChange={(v) => setValue(field.name, v)}
              />
            ))}
          </SettingsSection>
        )}
      </form>
    </div>
  )
}
