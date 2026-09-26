'use client'

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { CrewSettings } from '@nyx/schemas'
import { Button } from '@/components/ui/button'
import { Icons } from '@/lib/icons'
import { apiFetch } from '@/lib/auth'
import { useToast } from '@/lib/toast-context'
import { useConfirm } from '@/lib/confirm-context'
import { useShortcutContext } from '@/lib/keywatch'
import { extractError } from '@/lib/utils'
import { CrewSettingsEditor } from '../../../settings/crew-settings-editor'
import { Badge } from './DutyPanel'

// The crew plan's own duty rules. While it inherits (Scope/global) everything is read-only
// and "Customizar" copies the effective values into the plan; once customized the values
// are editable (diffed against the inherited ones) and "Restaurar padrão" drops the copy.

interface SettingsView { settings: CrewSettings; isCustom: boolean; inherited: CrewSettings }

interface Props {
  crewPlanId: string
  canEdit:    boolean
  // after any persisted change — the server already recalculated the plan
  onChanged:  () => void
  onClose:    () => void
}

async function call(path: string, init?: RequestInit): Promise<SettingsView> {
  const res  = await apiFetch(path, init)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(extractError(json))
  return json as SettingsView
}

export function CrewSettingsModal({ crewPlanId, canEdit, onChanged, onClose }: Props) {
  useShortcutContext('crew_settings_md')
  const { toast } = useToast()
  const confirm   = useConfirm()
  const base      = `/transit/crew-plan/${crewPlanId}/settings`

  const { data, refetch } = useQuery<SettingsView>({
    queryKey: ['transit', 'crew-plan', crewPlanId, 'settings'],
    queryFn:  () => call(base),
  })

  const [draft, setDraft]   = useState<CrewSettings | null>(null)
  const [saving, setSaving] = useState(false)

  // (re)seed the draft whenever the server copy changes (load, customize, save, restore)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (data) setDraft(data.settings) }, [data])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  const dirty = !!data && !!draft && JSON.stringify(draft) !== JSON.stringify(data.settings)

  async function run(fn: () => Promise<unknown>, success: string) {
    setSaving(true)
    try {
      await fn()
      await refetch()
      onChanged()
      toast.success(success)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar configuração')
    } finally {
      setSaving(false)
    }
  }

  async function handleRestore() {
    const ok = await confirm({
      title:        'Restaurar configuração padrão',
      description:  'Os valores personalizados desta escala serão descartados e ela volta a seguir a configuração do Scope/global.',
      confirmLabel: 'Restaurar',
      variant:      'destructive',
    })
    if (ok) await run(() => call(base, { method: 'DELETE' }), 'Configuração padrão restaurada')
  }

  const isCustom = !!data?.isCustom
  const editable = canEdit && isCustom && !saving

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 bg-card border border-border rounded-lg shadow-xl w-full max-w-5xl mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold">Configurações da escala</h2>
            {data && (isCustom
              ? <Badge tone="amber">Personalizada</Badge>
              : <Badge tone="green">Padrão (Scope/global)</Badge>)}
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground" title="Fechar">
            <Icons.X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {data && !isCustom && (
            <div className="flex items-center gap-x-2 rounded-sm p-3 mb-5 text-sm text-slate-50 bg-slate-500 dark:text-slate-300 dark:bg-slate-800/50">
              <Icons.Info className="w-4 h-4 shrink-0" />
              <span>Esta escala segue a configuração do Scope/global. Clique em &quot;Customizar&quot; para copiar os valores e ajustá-los só para esta escala.</span>
            </div>
          )}
          {draft && data ? (
            <CrewSettingsEditor
              value={draft}
              reference={isCustom ? data.inherited : null}
              onChange={setDraft}
              disabled={!editable}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-border">
          <div>
            {canEdit && isCustom && (
              <Button type="button" variant="destructive" size="sm" disabled={saving} onClick={() => void handleRestore()}>
                <Icons.RotateCcw className="w-3.5 h-3.5 me-1" /> Restaurar padrão
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="cancel" size="sm" onClick={onClose}>
              {isCustom && dirty ? 'Cancelar' : 'Fechar'}
            </Button>
            {canEdit && !isCustom && data && (
              <Button type="button" size="sm" disabled={saving} onClick={() => void run(() => call(`${base}/customize`, { method: 'POST' }), 'Configuração copiada para esta escala')}>
                <Icons.Settings2 className="w-3.5 h-3.5 me-1" /> Customizar
              </Button>
            )}
            {canEdit && isCustom && (
              <Button type="button" size="sm" disabled={saving || !dirty} onClick={() => void run(() => call(base, { method: 'PUT', body: JSON.stringify(draft) }), 'Configuração salva')}>
                <Icons.Save className="w-3.5 h-3.5 me-1" /> {saving ? 'Salvando…' : 'Salvar'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
