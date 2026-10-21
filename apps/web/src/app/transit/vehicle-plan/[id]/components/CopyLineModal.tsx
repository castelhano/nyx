'use client'

import { useState, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Input }  from '@/components/ui/input'
import { apiFetch } from '@/lib/auth'
import { extractError } from '@/lib/utils'
import { useToast } from '@/lib/toast-context'
import { useConfirm } from '@/lib/confirm-context'
import { useShortcutContext } from '@/lib/keywatch'

interface CopySource {
  id:          string
  description: string | null
  status:      'DRAFT' | 'ACTIVE' | 'SUPERSEDED'
  dayType:     { id: string; name: string }
  lines:       { lineId: string; code: string; name: string }[]
}

interface LineScheduleRow {
  id:          string
  status:      'DRAFT' | 'APPROVED' | 'SUPERSEDED' | 'ARCHIVED'
  approvalRef: string
}

interface CopyResult {
  blocks:           number
  trips:            number
  dissolvedBundles: { blockNumber: number; start: number }[]
}

interface Props {
  planId:       string
  dayTypeId:    string
  dayTypeName:  string
  // the line selected in "Linhas", preselected when the source plan has it
  initialLineId?: string
  // lines already in this plan — copying one replaces its blocks
  planLineIds:  Set<string>
  onCopied:     () => void | Promise<void>
  onClose:      () => void
}

const PLAN_STATUS: Record<string, string> = { DRAFT: 'Rascunho', ACTIVE: 'Ativo', SUPERSEDED: 'Substituído' }
const SCHEDULE_STATUS: Record<string, string> = { DRAFT: 'Rascunho', APPROVED: 'Aprovada' }
const NEW_SCHEDULE = '__new'

const clock = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

export function CopyLineModal({ planId, dayTypeId, dayTypeName, initialLineId, planLineIds, onCopied, onClose }: Props) {
  useShortcutContext('copy_line_md')
  const { toast }   = useToast()
  const confirm     = useConfirm()
  const queryClient = useQueryClient()

  const [sourcePlanId,   setSourcePlanId]   = useState('')
  const [lineId,         setLineId]         = useState('')
  const [scheduleChoice, setScheduleChoice] = useState('')
  const [approvalRef,    setApprovalRef]    = useState('')
  const [saving,         setSaving]         = useState(false)
  // groups dissolved by the copy — shown before closing
  const [result,         setResult]         = useState<CopyResult | null>(null)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const { data: sources = [], isLoading: loadingSources } = useQuery<CopySource[]>({
    queryKey: ['transit', 'vehicle-plan', planId, 'copy-sources'],
    queryFn:  async () => {
      const res = await apiFetch(`/transit/vehicle-plan/${planId}/copy-sources`)
      if (!res.ok) throw new Error('Erro ao carregar planejamentos')
      return res.json()
    },
  })
  const source = sources.find(s => s.id === sourcePlanId)

  const { data: schedules = [], isLoading: loadingSchedules } = useQuery<LineScheduleRow[]>({
    queryKey: ['transit', 'line-schedule', 'history', lineId, dayTypeId],
    queryFn:  async () => {
      const res = await apiFetch(`/transit/line-schedule?lineId=${lineId}&dayTypeId=${dayTypeId}&pageSize=999`)
      if (!res.ok) return []
      const json = await res.json()
      return json.data ?? []
    },
    enabled: !!lineId,
  })
  const linkable = useMemo(() => schedules.filter(s => s.status === 'APPROVED' || s.status === 'DRAFT'), [schedules])

  function pickSource(id: string) {
    setSourcePlanId(id)
    const lines = sources.find(s => s.id === id)?.lines ?? []
    setLineId(lines.find(l => l.lineId === (lineId || initialLineId))?.lineId ?? '')
    setScheduleChoice('')
  }

  // the approved OSO comes preselected; with none to link, a new one
  useEffect(() => {
    if (!lineId || loadingSchedules) return
    setScheduleChoice(linkable.find(s => s.status === 'APPROVED')?.id ?? linkable[0]?.id ?? NEW_SCHEDULE)
  }, [lineId, loadingSchedules, linkable])

  const lineCode = source?.lines.find(l => l.lineId === lineId)?.code ?? ''

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!source || !lineId || !scheduleChoice || saving) return
    if (planLineIds.has(lineId) && !await confirm({
      title:        `Substituir a linha ${lineCode}?`,
      description:  'Os carros que a linha já tem neste planejamento serão removidos e substituídos pela cópia.',
      confirmLabel: 'Substituir',
      variant:      'destructive',
    })) return

    setSaving(true)
    try {
      const res = await apiFetch(`/transit/vehicle-plan/${planId}/lines/${lineId}/copy-from`, {
        method: 'POST',
        body:   JSON.stringify({
          sourcePlanId,
          ...(scheduleChoice === NEW_SCHEDULE
            ? { newSchedule: { approvalRef: approvalRef.trim() || undefined } }
            : { lineScheduleId: scheduleChoice }),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(extractError(json, 'Erro ao copiar linha'))
      await queryClient.invalidateQueries({ queryKey: ['transit', 'line-schedule', 'history', lineId, dayTypeId] })
      await onCopied()
      const copied = json as CopyResult
      toast.success(`Linha ${lineCode} copiada — ${copied.blocks} carro(s), ${copied.trips} viagem(ns)`)
      if (copied.dissolvedBundles.length > 0) setResult(copied)
      else onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao copiar linha')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      {result ? (
        <div className="relative z-10 bg-card border border-border rounded-lg shadow-xl w-full max-w-md mx-4 p-6 space-y-4">
          <h2 className="text-base font-semibold">Grupos desfeitos na cópia</h2>
          <p className="text-sm text-muted-foreground">
            Estes grupos misturavam outra linha e a parte da {lineCode} não ficou seguida — as viagens vieram soltas.
          </p>
          <ul className="text-sm space-y-1 max-h-60 overflow-y-auto">
            {result.dissolvedBundles.map((b, i) => (
              <li key={i}>Carro {b.blockNumber} — grupo das {clock(b.start)}</li>
            ))}
          </ul>
          <div className="flex justify-end pt-1">
            <Button type="button" size="sm" autoFocus onClick={onClose}>Fechar</Button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="relative z-10 bg-card border border-border rounded-lg shadow-xl w-full max-w-md mx-4 p-6 space-y-4"
        >
          <div>
            <h2 className="text-base font-semibold">Copiar linha de outro planejamento</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Traz os carros da linha com seus grupos — só as viagens dela, sem as de outras linhas.
            </p>
          </div>

          <div>
            <label htmlFor="copySource" className="text-sm font-medium">Planejamento de origem <span className="ps-0.5">*</span></label>
            <Select
              id="copySource"
              wrapperClassName="mt-2"
              value={sourcePlanId}
              onChange={e => pickSource(e.target.value)}
              required
              autoFocus
              disabled={loadingSources}
            >
              <option value="">{loadingSources ? 'Carregando…' : sources.length === 0 ? 'Nenhum outro planejamento no escopo' : 'Selecione…'}</option>
              {sources.map(s => (
                <option key={s.id} value={s.id}>
                  {s.dayType.name} — {s.description || 'Sem descrição'} ({PLAN_STATUS[s.status] ?? s.status})
                </option>
              ))}
            </Select>
          </div>

          <div>
            <label htmlFor="copyLine" className="text-sm font-medium">Linha <span className="ps-0.5">*</span></label>
            <Select
              id="copyLine"
              wrapperClassName="mt-2"
              value={lineId}
              onChange={e => { setLineId(e.target.value); setScheduleChoice('') }}
              required
              disabled={!source}
            >
              <option value="">Selecione…</option>
              {source?.lines.map(l => (
                <option key={l.lineId} value={l.lineId}>{l.code} — {l.name}</option>
              ))}
            </Select>
            {lineId && planLineIds.has(lineId) && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">A linha já existe neste planejamento — seus carros serão substituídos.</p>
            )}
          </div>

          <div>
            <label htmlFor="copySchedule" className="text-sm font-medium">OSO a vincular ({dayTypeName}) <span className="ps-0.5">*</span></label>
            <Select
              id="copySchedule"
              wrapperClassName="mt-2"
              value={scheduleChoice}
              onChange={e => setScheduleChoice(e.target.value)}
              required
              disabled={!lineId || loadingSchedules}
            >
              <option value="">{loadingSchedules ? 'Carregando…' : 'Selecione…'}</option>
              {linkable.map(s => (
                <option key={s.id} value={s.id}>{s.approvalRef} ({SCHEDULE_STATUS[s.status]})</option>
              ))}
              <option value={NEW_SCHEDULE}>Nova OSO a partir das viagens copiadas</option>
            </Select>
            {scheduleChoice === NEW_SCHEDULE ? (
              <div className="mt-2">
                <Input
                  value={approvalRef}
                  onChange={e => setApprovalRef(e.target.value)}
                  placeholder="Número da OSO (vazio gera um rascunho)"
                />
              </div>
            ) : scheduleChoice && (
              <p className="text-xs text-muted-foreground mt-1">Se as viagens copiadas não baterem com as partidas desta OSO, a linha fica marcada como divergente.</p>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="cancel" size="sm" tabIndex={-1} onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" disabled={!source || !lineId || !scheduleChoice || saving}>
              {saving ? 'Copiando…' : 'Copiar'}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
