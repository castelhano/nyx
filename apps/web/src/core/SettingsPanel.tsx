'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { Save, ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMetadata } from './useMetadata'
import { AutoBreadcrumb } from './AutoBreadcrumb'
import { useTopbarActions } from '@/components/layout/topbar-actions-context'
import { useShortcut } from '@/lib/keywatch'
import { apiFetch } from '@/lib/auth'
import { useToast } from '@/lib/toast-context'
import { msgs } from '@/lib/messages'
import type { MetadataField } from '@nyx/types'
import { Switch } from '@/components/ui/switch'
import { Stepper } from '@/components/ui/stepper'

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
        <Switch checked={Boolean(value)} onToggle={() => onChange(!value)} />
      </div>
    )
  }

  if (field.widget === 'stepper' || field.type === 'number') {
    return (
      <div className="flex items-center justify-between gap-6 px-4 py-3">
        {label}
        <Stepper
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
  const canUpdate = meta?.permissions?.update !== false

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

  const [resetSignal, setResetSignal] = useState(0)
  const { toast } = useToast()

  const { handleSubmit, watch, setValue, reset } = useForm<Record<string, unknown>>({
    defaultValues: {},
  })
  const values = watch()

  useEffect(() => {
    if (serverValues) reset(serverValues)
  }, [serverValues, resetSignal]) // eslint-disable-line react-hooks/exhaustive-deps

  async function onSave(data: Record<string, unknown>) {
    try {
      const res = await apiFetch(`/${domain}/${resource}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(data),
      })
      if (!res.ok) throw new Error('Failed to save')
      queryClient.invalidateQueries({ queryKey: [domain, resource] })
      toast.success(msgs.saved())
    } catch {
      toast.error(msgs.error.save())
    }
  }

  useTopbarActions([
    ...(canUpdate ? [{ label: 'Gravar', icon: Save, type: 'submit' as const, form: FORM_ID, primary: true, keybind: 'ALT+G' }] : []),
  ], [canUpdate])

  useShortcut('alt+g', () => {
    if (canUpdate) (document.getElementById(FORM_ID) as HTMLFormElement | null)?.requestSubmit()
  }, { desc: 'Salvar configurações', icon: Save, context: 'all', origin: `SettingsPanel/${domain}/${resource}` })

  useShortcut('alt+v', () => router.push(`/${domain}`), {
    desc: 'Voltar', icon: ArrowLeft, context: 'all', origin: `SettingsPanel/${domain}/${resource}`,
  })

  useShortcut('alt+l', () => setResetSignal((s) => s + 1), {
    display: false,
    origin:  `SettingsPanel/${domain}/${resource}`,
  })

  const formFields = meta?.fields.filter((f) => f.showInForm) ?? []
  const groups     = meta?.groups

  return (
    <div className="p-6 max-w-3xl flex flex-col gap-8">
      <AutoBreadcrumb domain={domain} resource={resource} />

      <form id={FORM_ID} onSubmit={handleSubmit(onSave)} className={cn('flex flex-col gap-6', !canUpdate && 'pointer-events-none opacity-60')}>
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
