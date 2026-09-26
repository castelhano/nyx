'use client'

import { useState, useEffect } from 'react'
import { formatDutyNumber, CREW_ROLES, type CrewRole, type ReliefPoint } from '@nyx/schemas'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { useShortcutContext } from '@/lib/keywatch'
import type { BoardBlock, BoardDuty } from '../board.types'
import { fmtTime, ROLE_LABEL, KIND_LABEL } from '../board.types'

export type AssignTarget =
  | { kind: 'existing'; dutyId: string }
  | { kind: 'new'; role: CrewRole; dutyKind: BoardDuty['kind'] }

interface Props {
  block:          BoardBlock
  start:          ReliefPoint
  end:            ReliefPoint
  duties:         BoardDuty[]
  defaultDutyId:  string | null
  localityName:   (id: string) => string
  saving:         boolean
  onConfirm:      (target: AssignTarget) => void
  onClose:        () => void
}

export function AssignPieceModal({ block, start, end, duties, defaultDutyId, localityName, saving, onConfirm, onClose }: Props) {
  useShortcutContext('assign_piece_md')
  const [mode, setMode]         = useState<'existing' | 'new'>('new')
  const [dutyId, setDutyId]     = useState(defaultDutyId ?? duties[0]?.id ?? '')
  const [role, setRole]         = useState<CrewRole>('DRIVER')
  const [dutyKind, setDutyKind] = useState<BoardDuty['kind']>('STRAIGHT')

  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (mode === 'existing' && dutyId) onConfirm({ kind: 'existing', dutyId })
    if (mode === 'new') onConfirm({ kind: 'new', role, dutyKind })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <form onSubmit={handleSubmit} className="relative z-10 bg-card border border-border rounded-lg shadow-xl w-full max-w-md mx-4 p-6 space-y-4">
        <h2 className="text-base font-semibold">Nova pegada — Carro {block.blockNumber}</h2>

        <p className="text-sm text-muted-foreground">
          {fmtTime(start.minutes)} {localityName(start.localityId)} → {fmtTime(end.minutes)} {localityName(end.localityId)}
        </p>

        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" checked={mode === 'existing'} onChange={() => setMode('existing')} disabled={duties.length === 0} />
            Jornada existente
          </label>
          {mode === 'existing' && (
            <Select value={dutyId} onChange={e => setDutyId(e.target.value)} size="sm" autoFocus>
              {duties.map(d => (
                <option key={d.id} value={d.id}>
                  {formatDutyNumber(d.role, d.dutyNumber)} · {ROLE_LABEL[d.role]} · {KIND_LABEL[d.kind]}
                </option>
              ))}
            </Select>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} />
            Nova jornada
          </label>
          {mode === 'new' && (
            <div className="grid grid-cols-2 gap-2">
              <Select value={role} onChange={e => setRole(e.target.value as CrewRole)} size="sm">
                {CREW_ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </Select>
              <Select value={dutyKind} onChange={e => setDutyKind(e.target.value as BoardDuty['kind'])} size="sm">
                {(Object.keys(KIND_LABEL) as BoardDuty['kind'][]).map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </Select>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="cancel" size="sm" onClick={onClose}>Cancelar</Button>
          <Button type="submit" size="sm" disabled={saving || (mode === 'existing' && !dutyId)}>
            {saving ? 'Salvando…' : 'Adicionar'}
          </Button>
        </div>
      </form>
    </div>
  )
}
