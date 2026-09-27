'use client'

import { useState, useEffect } from 'react'
import { formatDutyNumber } from '@nyx/schemas'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { useShortcutContext } from '@/lib/keywatch'
import type { BoardDuty } from '../board.types'
import { fmtTime, parseTime } from '../board.types'
import type { ActivityInput } from './DutyPanel'
import { useIntervalTypes } from '../../../use-interval-types'

export interface BreakDraft {
  duty:           BoardDuty
  // the free slot clicked — the break may be trimmed but not extended past it
  startMinutes:   number
  endMinutes:     number
  inPiece:        boolean
  // the vehicle's own interval type when the stretch holds one
  intervalTypeId: string | null
}

interface Props {
  draft:     BreakDraft
  saving:    boolean
  onConfirm: (input: ActivityInput) => void
  onClose:   () => void
}

const inputCls = 'w-full h-8 border border-input rounded-sm text-sm bg-input-bg px-2 focus:outline-none focus:ring-1 focus:ring-ring'

// Break on a free slot of the duty view — the vehicle's idle time inside a piece or the gap
// between two pieces — prefilled with the whole slot.
export function BreakModal({ draft, saving, onConfirm, onClose }: Props) {
  useShortcutContext('break_md')
  const { data: intervalTypes = [] } = useIntervalTypes()
  const [start, setStart]   = useState(fmtTime(draft.startMinutes))
  const [end, setEnd]       = useState(fmtTime(draft.endMinutes))
  const [typeId, setTypeId] = useState(draft.intervalTypeId ?? '')

  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  // operational-day times, as elsewhere on the board (after midnight = 24:00+)
  const startMin = parseTime(start), endMin = parseTime(end)
  const inside = startMin != null && endMin != null && endMin > startMin
    && startMin >= draft.startMinutes && endMin <= draft.endMinutes
  const valid = inside && !!typeId

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (valid) onConfirm({ type: 'BREAK', intervalTypeId: typeId, startMinutes: startMin, endMinutes: endMin })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <form onSubmit={handleSubmit} className="relative z-10 bg-card border border-border rounded-lg shadow-xl w-full max-w-sm mx-4 p-6 space-y-4">
        <h2 className="text-base font-semibold">Intervalo — {formatDutyNumber(draft.duty.role, draft.duty.dutyNumber)}</h2>
        <p className="text-sm text-muted-foreground">
          {draft.inPiece ? 'Carro parado' : 'Entre pegadas'} de {fmtTime(draft.startMinutes)} a {fmtTime(draft.endMinutes)}
        </p>

        <div className="grid grid-cols-2 gap-2">
          <input value={start} onChange={e => setStart(e.target.value)} placeholder="Início (HH:MM)" className={inputCls} autoFocus />
          <input value={end} onChange={e => setEnd(e.target.value)} placeholder="Fim (HH:MM)" className={inputCls} />
          <Select value={typeId} onChange={e => setTypeId(e.target.value)} size="sm" wrapperClassName="col-span-2">
            <option value="">Tipo de intervalo…</option>
            {intervalTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </div>
        {!inside && startMin != null && endMin != null && (
          <p className="text-xs text-red-600 dark:text-red-400">O intervalo precisa ficar dentro do trecho livre</p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="cancel" size="sm" onClick={onClose}>Cancelar</Button>
          <Button type="submit" size="sm" disabled={saving || !valid}>
            {saving ? 'Salvando…' : 'Adicionar'}
          </Button>
        </div>
      </form>
    </div>
  )
}
