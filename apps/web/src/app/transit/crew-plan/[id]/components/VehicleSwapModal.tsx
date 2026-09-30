'use client'

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { formatDutyNumber } from '@nyx/schemas'
import { Button } from '@/components/ui/button'
import { Icons } from '@/lib/icons'
import { apiFetch } from '@/lib/auth'
import { cn, extractError } from '@/lib/utils'
import { useToast } from '@/lib/toast-context'
import { useShortcutContext } from '@/lib/keywatch'
import type { BoardDuty } from '../board.types'
import { fmtTime } from '../board.types'
import { Badge } from './DutyPanel'

// "Otimizar › Reduzir trocas de carro" — lists the tail swaps the API found (an independent
// set: any combination can be applied): direct junctions first, pre-checked like the
// recommended ones.

type Junction = 'DIRECT' | 'DEPOT' | 'DISPLACEMENT'

interface Candidate {
  key:                 string
  x:                   { blockId: string; blockNumber: number; cutMinutes: number }
  y:                   { blockId: string; blockNumber: number; cutMinutes: number }
  junction:            Junction
  gain:                number
  duties:              { dutyId: string; before: number; after: number }[]
  deadrunMinutesDelta: number
  deadrunKmDelta:      number
  uncoveredDelta:      number
  staleElsewhere:      number
  recommended:         boolean
}

const JUNCTION: Record<Junction, { label: string; tone: 'green' | 'amber' | 'red' }> = {
  DIRECT:       { label: 'Emenda direta',     tone: 'green' },
  DEPOT:        { label: 'Via depósito',      tone: 'amber' },
  DISPLACEMENT: { label: 'Deslocamento novo', tone: 'red' },
}

const signed = (n: number, unit: string) => `${n > 0 ? '+' : ''}${n.toLocaleString('pt-BR')} ${unit}`

interface Props {
  crewPlanId: string
  duties:     BoardDuty[]
  onApplied:  () => void
  onClose:    () => void
}

export function VehicleSwapModal({ crewPlanId, duties, onApplied, onClose }: Props) {
  useShortcutContext('vehicle_swap_md')
  const { toast } = useToast()
  const base = `/transit/crew-plan/${crewPlanId}/vehicle-swaps`

  const { data, error, isFetching, refetch } = useQuery<Candidate[]>({
    queryKey: ['transit', 'crew-plan', crewPlanId, 'vehicle-swaps'],
    queryFn:  async () => {
      const res  = await apiFetch(base)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(extractError(json))
      // direct junctions on top, the API's order kept within each group
      return (json as Candidate[]).map((c, i) => ({ c, i }))
        .sort((a, b) => Number(b.c.junction === 'DIRECT') - Number(a.c.junction === 'DIRECT') || a.i - b.i)
        .map(x => x.c)
    },
    staleTime: 0,
    gcTime:    0,
  })

  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [saving, setSaving]   = useState(false)

  // (re)seed the selection with the recommended and every direct junction whenever the analysis changes
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (data) setChecked(new Set(data.filter(c => c.recommended || c.junction === 'DIRECT').map(c => c.key))) }, [data])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  const dutyLabel = new Map(duties.map(d => [d.id, formatDutyNumber(d.role, d.dutyNumber)]))
  const selected  = (data ?? []).filter(c => checked.has(c.key))
  const gain      = selected.reduce((s, c) => s + c.gain, 0)

  function toggle(key: string) {
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function handleApply() {
    setSaving(true)
    try {
      const res  = await apiFetch(`${base}/apply`, { method: 'POST', body: JSON.stringify({ keys: selected.map(c => c.key) }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(extractError(json))
        // 409: the plan changed since the analysis — show the current one
        if (res.status === 409) void refetch()
        return
      }
      toast.success(`${selected.length} ${selected.length === 1 ? 'troca aplicada' : 'trocas aplicadas'}`)
      onApplied()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 bg-card border border-border rounded-lg shadow-xl w-full max-w-3xl mx-4 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold">Reduzir trocas de carro</h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground" title="Fechar">
            <Icons.X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Cada item troca entre dois carros tudo o que eles fazem a partir do corte — as partidas não mudam.
            As pegadas acompanham as viagens em todas as versões desta escala. A alteração vale para o
            planejamento de veículos ativo e não pode ser desfeita automaticamente.
          </p>

          {isFetching && !data && <p className="text-sm text-muted-foreground">Analisando…</p>}
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error.message}</p>}
          {data && data.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhuma troca possível reduz as trocas de carro desta escala.</p>
          )}

          <ul className="space-y-2">
            {(data ?? []).map(c => {
              const junction = JUNCTION[c.junction]
              return (
                <li key={c.key}>
                  <label className={cn(
                    'flex items-start gap-3 rounded-md border px-3 py-2 text-sm cursor-pointer',
                    checked.has(c.key) ? 'border-accent-foreground/40 bg-accent/30' : 'border-border',
                  )}>
                    <input type="checkbox" className="mt-1" checked={checked.has(c.key)} onChange={() => toggle(c.key)} />
                    <span className="flex-1 min-w-0 space-y-1">
                      <span className="block font-medium">
                        Carro {c.x.blockNumber} a partir de {fmtTime(c.x.cutMinutes)}
                        <Icons.ArrowLeftRight className="inline w-3.5 h-3.5 mx-1.5 align-[-2px]" />
                        Carro {c.y.blockNumber} a partir de {fmtTime(c.y.cutMinutes)}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {c.duties.map(d => `${dutyLabel.get(d.dutyId) ?? '?'} ${signed(d.after - d.before, d.after - d.before === -1 ? 'troca' : 'trocas')}`).join(' · ')}
                        {(c.deadrunMinutesDelta !== 0 || c.deadrunKmDelta !== 0) && <> · ociosa {signed(c.deadrunMinutesDelta, 'min')} / {signed(c.deadrunKmDelta, 'km')}</>}
                      </span>
                      {c.uncoveredDelta > 0 && (
                        <span className="block text-xs text-red-600 dark:text-red-400">{signed(c.uncoveredDelta, 'min')} sem motorista nos dois carros</span>
                      )}
                      {c.staleElsewhere > 0 && (
                        <span className="block text-xs text-amber-600 dark:text-amber-400">
                          {c.staleElsewhere} {c.staleElsewhere === 1 ? 'pegada de outra versão ficará desatualizada' : 'pegadas de outras versões ficarão desatualizadas'}
                        </span>
                      )}
                    </span>
                    <Badge tone={junction.tone} className="mt-0.5 w-28 shrink-0 text-center">{junction.label}</Badge>
                  </label>
                </li>
              )
            })}
          </ul>
        </div>

        <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-border">
          <span className="text-xs text-muted-foreground">
            {selected.length > 0 && `${selected.length} selecionada${selected.length > 1 ? 's' : ''} · −${gain} ${gain === 1 ? 'troca' : 'trocas'} de carro`}
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="cancel" size="sm" onClick={onClose}>Cancelar</Button>
            <Button type="button" size="sm" disabled={saving || selected.length === 0} onClick={() => void handleApply()}>
              {saving ? 'Aplicando…' : 'Aplicar'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
