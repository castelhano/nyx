'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Icons } from '@/lib/icons'
import { useToast } from '@/lib/toast-context'
import { extractError } from '@/lib/utils'
import { apiPost, apiPatch, apiDelete } from './api'
import { StopGlyph } from './StopGlyph'
import { SUGGEST_COLOR, type RouteLocality, type SuggestedLocality } from './types'

// client-only id for a suggested point spliced into the draft, not yet persisted
const NEW_ID = '__new__'

interface Props {
  routeId: string
  localities: RouteLocality[]  // already sorted by sequence — first = origin, last = destination
  color: string
  disabled: boolean            // true while there are unsaved pending points on the main screen
  insertTarget?: SuggestedLocality | null  // suggested point to pre-insert and let the user position before saving
  onClose: () => void
  onSaved: () => void
}

function label(rl: RouteLocality): string {
  if (rl.id === NEW_ID) return rl.locality?.name ?? 'Novo ponto'
  return rl.locality?.abbr || rl.locality?.name || (rl.localityId ? `Ponto ${rl.sequence}` : 'Waypoint')
}

function targetRow(s: SuggestedLocality): RouteLocality {
  return {
    id: NEW_ID, routeId: '', localityId: s.id, lat: null, lng: null, sequence: -1,
    deltaMinutes: null, deltaKm: null, deltaSource: 'OSRM', geometry: null,
    allowsCrewChange: false, updatedAt: '',
    locality: { id: s.id, name: s.name, code: s.code, abbr: null, lat: s.lat, lng: s.lng },
  }
}

export function SeqModal({ routeId, localities, color, disabled, insertTarget, onClose, onSaved }: Props) {
  const { toast } = useToast()
  const [draft,   setDraft]   = useState<RouteLocality[]>(() => {
    const base = [...localities]
    if (!insertTarget) return base
    // anchor after the given stop, clamped so origin/destination stay first/last
    const anchorIdx = base.findIndex((rl) => rl.sequence === insertTarget.insertAfterSequence)
    const insertAt  = Math.min(Math.max(anchorIdx === -1 ? 1 : anchorIdx + 1, 1), base.length - 1)
    base.splice(insertAt, 0, targetRow(insertTarget))
    return base
  })
  const [saving,  setSaving]  = useState(false)

  const lastIdx     = draft.length - 1
  const hasChanges  = draft.length !== localities.length || draft.some((rl, i) => rl.id !== localities[i].id)

  function moveUp(idx: number) {
    setDraft((prev) => {
      if (idx <= 1) return prev
      const next = [...prev]
      ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
      return next
    })
  }

  function moveDown(idx: number) {
    setDraft((prev) => {
      if (idx >= prev.length - 2) return prev
      const next = [...prev]
      ;[next[idx + 1], next[idx]] = [next[idx], next[idx + 1]]
      return next
    })
  }

  function moveTo(idx: number, targetPos: number) {
    setDraft((prev) => {
      const n = prev.length
      const target = Math.min(Math.max(Math.round(targetPos), 1), n - 2)
      if (target === idx) return prev
      const next = [...prev]
      const [item] = next.splice(idx, 1)
      next.splice(target, 0, item)
      return next
    })
  }

  function removeAt(idx: number) {
    setDraft((prev) => prev.filter((_, i) => i !== idx))
  }

  async function handleSave() {
    setSaving(true)
    try {
      const originalIds = new Set(localities.map((rl) => rl.id))
      const draftIds    = new Set(draft.map((rl) => rl.id))
      const deletedIds  = [...originalIds].filter((id) => !draftIds.has(id))
      const hasDeletion = deletedIds.length > 0

      await Promise.all(deletedIds.map((id) => apiDelete(`/transit/route-locality/${id}`)))

      const withSeq = draft.map((rl, i) => ({ rl, seq: i + 1 }))
      const newRow  = withSeq.find(({ rl }) => rl.id === NEW_ID)
      const changed = withSeq.filter(({ rl, seq }) => rl.id !== NEW_ID && rl.sequence !== seq)

      if (changed.length > 0) {
        // wave 1 — move existing rows out of the way before the new row (if any)
        // lands on its final sequence, avoiding a @@unique([routeId, sequence]) collision
        const OFFSET = 1_000_000
        await Promise.all(changed.map(({ rl, seq }) => apiPatch(`/transit/route-locality/${rl.id}`, { sequence: seq + OFFSET })))
      }
      if (newRow) {
        await apiPost('/transit/route-locality', {
          routeId, localityId: newRow.rl.localityId, sequence: newRow.seq, allowsCrewChange: false,
        })
      }
      if (changed.length > 0) {
        await Promise.all(changed.map(({ rl, seq }) => apiPatch(`/transit/route-locality/${rl.id}`, { sequence: seq })))
      }

      if (hasDeletion || changed.length > 0 || newRow) {
        // deletion merges legs — force a full recompute, overriding MANUAL overrides on the affected legs
        await apiPost(`/transit/transit-route/${routeId}/reprocess`, hasDeletion ? { forceAll: true } : undefined)
      }

      onSaved()
      onClose()
    } catch (err) {
      toast.error(extractError(err as Record<string, unknown>, 'Erro ao salvar sequência'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-background border border-border rounded-md shadow-lg w-full max-w-lg p-6 space-y-4">
        <h2 className="text-lg font-semibold">Sequência de pontos</h2>
        {insertTarget && (
          <p className="text-xs text-muted-foreground -mt-2">
            Posicione <strong>{insertTarget.name}</strong> na sequência antes de salvar
          </p>
        )}

        {disabled && (
          <div className="px-3 py-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-sm text-xs text-amber-700 dark:text-amber-400">
            Existem pontos pendentes de gravação. Grave-os na tela principal (botão Gravar) antes de editar a sequência.
          </div>
        )}

        <div className="max-h-96 overflow-y-auto border border-border rounded-sm">
          {draft.map((rl, idx) => {
            const isOrigin = idx === 0
            const isDest   = idx === lastIdx
            const isLocked = isOrigin || isDest
            const isNew    = rl.id === NEW_ID

            return (
              <div
                key={rl.id}
                className={`flex items-center gap-2 px-3 py-2 border-b border-border last:border-0 ${isNew ? 'bg-violet-50 dark:bg-violet-950/30' : ''}`}
              >
                <StopGlyph
                  kind={isOrigin ? 'origin' : isDest ? 'destination' : rl.localityId ? 'stop' : 'waypoint'}
                  color={isNew ? SUGGEST_COLOR : color}
                  size={16}
                />
                <span className="w-6 text-xs text-muted-foreground text-center shrink-0">{idx}</span>
                <span className="flex-1 text-sm truncate">{label(rl)}</span>
                {isNew && (
                  <span className="text-[10px] text-violet-600 dark:text-violet-400 uppercase shrink-0 px-1.5 font-medium">
                    Novo
                  </span>
                )}

                {isLocked ? (
                  <span className="text-[10px] text-muted-foreground uppercase shrink-0 px-1.5">
                    {isOrigin ? 'Origem' : 'Destino'}
                  </span>
                ) : (
                  <>
                    <input
                      key={`pos-${rl.id}-${idx}`}
                      type="number"
                      className="w-14 h-7 px-1 text-xs text-center border border-input rounded-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                      defaultValue={idx}
                      min={1}
                      max={lastIdx - 1}
                      disabled={disabled}
                      onBlur={(e) => {
                        const v = Number(e.target.value)
                        if (!Number.isNaN(v)) moveTo(idx, v)
                      }}
                    />
                    <Button type="button" variant="rowAction" size="icon" disabled={disabled || idx <= 1} onClick={() => moveUp(idx)}>
                      <Icons.ArrowUp className="w-3.5 h-3.5" />
                    </Button>
                    <Button type="button" variant="rowAction" size="icon" disabled={disabled || idx >= lastIdx - 1} onClick={() => moveDown(idx)}>
                      <Icons.ArrowDown className="w-3.5 h-3.5" />
                    </Button>
                    <Button type="button" variant="rowAction" size="icon" disabled={disabled} onClick={() => removeAt(idx)}>
                      <Icons.Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </>
                )}
              </div>
            )
          })}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="cancel" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button type="button" onClick={handleSave} disabled={disabled || !hasChanges || saving}>
            {saving ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      </div>
    </div>
  )
}
