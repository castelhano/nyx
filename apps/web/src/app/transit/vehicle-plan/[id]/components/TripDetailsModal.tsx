'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { Button }       from '@/components/ui/button'
import { ColorPicker }  from '@/components/ui/color-picker'
import { Switch }       from '@/components/ui/switch'
import { Icons }        from '@/lib/icons'
import { useShortcut, useShortcutContext } from '@/lib/keywatch'
import type { TripMarking, TripMarkingFontStyle, TripMarkingBgColor } from '@nyx/schemas'
import type { VehiclePlanGanttData } from '../views/vehicles.view'
import type { StopPattern } from '../hooks/useGanttEditor'

const STOP_PATTERN_OPTIONS: { value: StopPattern; label: string }[] = [
  { value: 'LOCAL',   label: 'Paradora' },
  { value: 'LIMITED', label: 'Semiexpressa' },
  { value: 'EXPRESS', label: 'Expressa' },
]

// Paleta fechada (docs/proposal/plan_trip_markings_v1.md, regra 5) — mesmos tons usados
// no export OSO (oso-workbook.renderer.ts BG_COLOR_FILLS), sem o canal alfa do ARGB.
// Exportado para reaproveitar o mesmo swatch em LineSummaryView (aba Detalhes).
export const BG_COLOR_OPTIONS: { value: TripMarkingBgColor; hex: string }[] = [
  { value: 'AZUL',     hex: '#BDD7EE' },
  { value: 'VERDE',    hex: '#C6E0B4' },
  { value: 'ROSA',     hex: '#F4B6C2' },
  { value: 'ROXO',     hex: '#D9C2EC' },
  { value: 'CINZA',    hex: '#D9D9D9' },
  { value: 'VERMELHO', hex: '#F2A5A0' },
]
const NO_COLOR_HEX = '#e5e7eb'

export const FONT_STYLE_OPTIONS: { value: TripMarkingFontStyle; label: string }[] = [
  { value: 'BOLD',          label: 'Negrito' },
  { value: 'ITALIC',        label: 'Itálico' },
  { value: 'BOLD_ITALIC',   label: 'Negrito + itálico' },
  { value: 'UNDERLINE',     label: 'Sublinhado' },
  { value: 'STRIKETHROUGH', label: 'Tachado' },
]

interface Row {
  key:          string
  legendText:   string
  // legendText de origem desta linha — usado pra localizar a marcação em outras
  // viagens do painel e replicar a edição (texto OU estilo) nelas. null = marcação
  // nova, digitada do zero (nunca existiu em nenhuma viagem do painel, nada a
  // localizar/replicar).
  originalText:      string | null
  originalFontStyle?: TripMarkingFontStyle
  originalBgColor?:   TripMarkingBgColor
  fontStyle?:   TripMarkingFontStyle
  bgColor?:     TripMarkingBgColor
}

interface Props {
  tripIds:          string[]
  mergedPlottedData: VehiclePlanGanttData
  onUpdateMarkings:    (tripIds: string[], patches: (TripMarking[] | null)[]) => void
  onUpdateStopPattern: (tripIds: string[], value: StopPattern) => void
  onUpdateNotes:       (tripIds: string[], value: string | null) => void
  onClose:          () => void
}

function newRowKey(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `row-${Math.random().toString(36).slice(2)}`
}

export function TripDetailsModal({ tripIds, mergedPlottedData, onUpdateMarkings, onUpdateStopPattern, onUpdateNotes, onClose }: Props) {
  useShortcutContext('trip_details_md')

  const allBlockTrips = useMemo(
    () => mergedPlottedData.blocks.flatMap(b => b.blockTrips),
    [mergedPlottedData],
  )

  const selectionSet = useMemo(() => new Set(tripIds), [tripIds])

  const selectedTrips = useMemo(
    () => allBlockTrips.filter(bt => selectionSet.has(bt.trip.id)).map(bt => bt.trip),
    [allBlockTrips, selectionSet],
  )

  // ── stopPattern — always uniform on save, same all-or-nothing treatment as
  // markings below. Seeded from the first selected trip when the selection agrees;
  // otherwise from whichever trip happens to be first (low-stakes closed enum, no
  // conflict UI needed — unlike notes, there's no free-text data to lose).
  const [stopPatternValue, setStopPatternValue] = useState<StopPattern>(
    () => selectedTrips[0]?.stopPattern ?? 'LOCAL',
  )

  // ── notes — free text, one value per trip, never swept like markings. A
  // divergent selection needs explicit opt-in before a single value overwrites
  // every trip's own text (see notesConflict below).
  const distinctNotes = useMemo(
    () => [...new Set(selectedTrips.map(t => t.notes ?? ''))],
    [selectedTrips],
  )
  const notesConflict = distinctNotes.length > 1
  const [notesValue, setNotesValue] = useState<string>(
    () => notesConflict ? distinctNotes.filter(n => n.length > 0).join('; ') : (distinctNotes[0] ?? ''),
  )
  const [notesReplicate, setNotesReplicate] = useState(false)

  const [rows, setRows] = useState<Row[]>(() => {
    const byText = new Map<string, Row>()
    for (const bt of allBlockTrips) {
      if (!selectionSet.has(bt.trip.id)) continue
      for (const m of bt.trip.markings ?? []) {
        if (!byText.has(m.legendText)) {
          byText.set(m.legendText, {
            key: newRowKey(), legendText: m.legendText, originalText: m.legendText,
            fontStyle: m.fontStyle, bgColor: m.bgColor,
            originalFontStyle: m.fontStyle, originalBgColor: m.bgColor,
          })
        }
      }
    }
    return [...byText.values()]
  })

  // Quick-pick: labels já usados nas viagens das linhas atualmente carregadas no Gantt
  // (mergedPlottedData já vem filtrado às linhas selecionadas p/ exibição), deduplicado
  // por legendText — sem chamada nova ao backend (docs/proposal/plan_trip_markings_v1.md,
  // Fase 3).
  const quickPicks = useMemo(() => {
    const byText = new Map<string, TripMarking>()
    for (const bt of allBlockTrips) {
      for (const m of bt.trip.markings ?? []) {
        if (!byText.has(m.legendText)) byText.set(m.legendText, m)
      }
    }
    return [...byText.values()]
  }, [allBlockTrips])

  // Quantas viagens (fora da seleção atual) seriam afetadas se a marcação de
  // legendText `from` for reescrita agora (texto ou estilo) — mostrado ao usuário
  // antes de confirmar (regra do doc, Fase 3, estendida a edição de estilo).
  function countAffectedByRename(from: string): number {
    let n = 0
    for (const bt of allBlockTrips) {
      if (selectionSet.has(bt.trip.id)) continue
      if ((bt.trip.markings ?? []).some(m => m.legendText === from)) n++
    }
    return n
  }

  function updateRow(key: string, patch: Partial<Row>) {
    setRows(prev => prev.map(r => r.key === key ? { ...r, ...patch } : r))
  }

  function removeRow(key: string) {
    setRows(prev => prev.filter(r => r.key !== key))
  }

  // A quick-pick seed loads a marking that already exists elsewhere in the panel —
  // originalText/originalFontStyle/originalBgColor are seeded from it (not null)
  // so that editing the style afterwards (without touching the text) still counts
  // as a change to sweep-replicate below, same as a rename does. A row typed from
  // scratch (no seed) has no known origin, so nothing to locate/replicate.
  function addRow(seed?: TripMarking) {
    if (seed && rows.some(r => r.legendText === seed.legendText)) return
    setRows(prev => [...prev, {
      key:               newRowKey(),
      legendText:        seed?.legendText ?? '',
      originalText:      seed?.legendText ?? null,
      fontStyle:         seed?.fontStyle,
      bgColor:           seed?.bgColor,
      originalFontStyle: seed?.fontStyle,
      originalBgColor:   seed?.bgColor,
    }])
  }

  const textInputRef = useRef<HTMLInputElement>(null)
  const formRef      = useRef<HTMLFormElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  function handleSave() {
    const cleanRows = rows
      .map(r => ({ ...r, legendText: r.legendText.trim() }))
      .filter(r => r.legendText.length > 0)

    // 1. edições (texto e/ou estilo) de marcações com origem conhecida — varre TODAS
    // as viagens carregadas no painel, exceto a seleção atual (que recebe a escrita
    // autoritativa abaixo) — regra 7/Fase 3: nunca no plano inteiro, só nas linhas
    // atualmente carregadas. Cobre tanto renomear o texto quanto só trocar o estilo
    // de uma marcação carregada via quick-pick (fontStyle/bgColor não são
    // sincronizados pelo schema entre viagens — regra 2 — mas dentro desta edição
    // pontual, nas linhas selecionadas, a intenção é replicar).
    const edited = cleanRows.filter(r => r.originalText && (
      r.originalText !== r.legendText ||
      r.fontStyle    !== r.originalFontStyle ||
      r.bgColor      !== r.originalBgColor
    ))
    if (edited.length > 0) {
      const sweepTripIds: string[] = []
      const sweepPatches: (TripMarking[] | null)[] = []
      for (const bt of allBlockTrips) {
        if (selectionSet.has(bt.trip.id)) continue
        const current = bt.trip.markings ?? []
        let changed = false
        const next = current.map(m => {
          const hit = edited.find(r => r.originalText === m.legendText)
          if (!hit) return m
          changed = true
          return { legendText: hit.legendText, fontStyle: hit.fontStyle, bgColor: hit.bgColor }
        })
        if (changed) { sweepTripIds.push(bt.trip.id); sweepPatches.push(next) }
      }
      if (sweepTripIds.length > 0) onUpdateMarkings(sweepTripIds, sweepPatches)
    }

    // 2. estado final da seleção — mesmo tratamento "tudo ou nada" do botão de lock
    // (makeLockAction em vehicles.actions.ts): a lista editada aqui vale igual para
    // toda viagem da seleção atual.
    const finalMarkings: TripMarking[] = cleanRows.map(r => ({
      legendText: r.legendText,
      fontStyle:  r.fontStyle,
      bgColor:    r.bgColor,
    }))
    const finalValue = finalMarkings.length > 0 ? finalMarkings : null
    onUpdateMarkings(tripIds, tripIds.map(() => finalValue))

    onUpdateStopPattern(tripIds, stopPatternValue)

    // notes: uniform write same as markings/stopPattern above, except when the
    // selection started out divergent and the user left "replicar" off — then
    // every trip's own text is left untouched instead of being overwritten.
    if (!notesConflict || notesReplicate) {
      const trimmed = notesValue.trim()
      onUpdateNotes(tripIds, trimmed.length > 0 ? trimmed : null)
    }

    onClose()
  }

  useShortcut('alt+g', () => formRef.current?.requestSubmit(), {
    desc:    'Salvar detalhes da viagem',
    icon:    Icons.Save,
    context: 'trip_details_md',
    origin:  'apps/web/src/app/transit/vehicle-plan/[id]/components/TripDetailsModal.tsx',
  })

  const availableQuickPicks = quickPicks.filter(q => !rows.some(r => r.legendText === q.legendText))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <form
        ref={formRef}
        onSubmit={e => { e.preventDefault(); handleSave() }}
        className="relative z-10 bg-card border border-border rounded-lg shadow-xl w-full max-w-lg mx-4 p-5 space-y-4 max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            Detalhes da Viagem {tripIds.length > 1 ? `(${tripIds.length} viagens)` : ''}
          </h2>
          <button type="button" onClick={onClose} className="p-0.5 rounded hover:bg-accent text-muted-foreground">
            <Icons.X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Perfil de embarque</label>
          <div className="relative">
            <select
              value={stopPatternValue}
              onChange={e => setStopPatternValue(e.target.value as StopPattern)}
              autoFocus
              className="w-full appearance-none border border-input rounded-sm text-sm bg-input-bg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {STOP_PATTERN_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <Icons.ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground">Observações</label>
            {notesConflict && (
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <span className="text-xs text-muted-foreground">{notesReplicate ? 'Replicar' : 'Não replicar'}</span>
                <Switch checked={notesReplicate} onToggle={() => setNotesReplicate(v => !v)} />
              </label>
            )}
          </div>
          {notesConflict && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Viagens selecionadas têm observações diferentes — escolha o texto final e ligue &quot;Replicar&quot; para aplicar a todas.
            </p>
          )}
          <textarea
            value={notesValue}
            onChange={e => setNotesValue(e.target.value)}
            disabled={notesConflict && !notesReplicate}
            rows={2}
            placeholder="Observações..."
            className="w-full border border-input rounded-sm text-sm bg-input-bg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed resize-none"
          />
        </div>

        <div className="border-t border-border pt-3 space-y-3">
          <p className="text-xs font-medium text-muted-foreground">Marcações</p>
          {rows.length === 0 && (
            <p className="text-xs text-muted-foreground">Nenhuma marcação nesta seleção.</p>
          )}

          {rows.map(row => {
            const wasEdited = row.originalText != null && (
              row.originalText !== row.legendText ||
              row.fontStyle    !== row.originalFontStyle ||
              row.bgColor      !== row.originalBgColor
            )
            const affected = wasEdited ? countAffectedByRename(row.originalText!) : 0
            return (
              <div key={row.key} className="border border-border rounded-md p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    value={row.legendText}
                    onChange={e => updateRow(row.key, { legendText: e.target.value })}
                    placeholder="Texto da legenda"
                    className="flex-1 border border-input rounded-sm text-sm bg-input-bg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <button
                    type="button"
                    title="Remover da seleção"
                    onClick={() => removeRow(row.key)}
                    className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                  >
                    <Icons.Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {affected > 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Alteração afetará mais {affected} {affected === 1 ? 'viagem' : 'viagens'} do painel.
                  </p>
                )}

                <div className="flex items-center gap-4">
                  <select
                    value={row.fontStyle ?? ''}
                    onChange={e => updateRow(row.key, { fontStyle: (e.target.value || undefined) as TripMarkingFontStyle | undefined })}
                    className="border border-input rounded-sm text-xs bg-input-bg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="">Estilo — nenhum</option>
                    {FONT_STYLE_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>

                  <ColorPicker
                    value={row.bgColor ? BG_COLOR_OPTIONS.find(o => o.value === row.bgColor)!.hex : null}
                    onChange={hex => updateRow(row.key, { bgColor: hex ? BG_COLOR_OPTIONS.find(o => o.hex === hex)!.value : undefined })}
                    palette={BG_COLOR_OPTIONS.map(o => o.hex)}
                    autoColor={NO_COLOR_HEX}
                    autoLabel="Sem cor"
                  />
                </div>
              </div>
            )
          })}

          <div className="flex items-center gap-2">
            <input
              ref={textInputRef}
              placeholder="Nova marcação…"
              data-keywatch="none"
              onKeyDown={e => {
                if (e.key !== 'Enter') return
                const el = e.currentTarget
                if (!el.value.trim()) return
                addRow({ legendText: el.value.trim() })
                el.value = ''
              }}
              className="flex-1 border border-input rounded-sm text-sm bg-input-bg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const val = textInputRef.current?.value.trim()
                if (!val) return
                addRow({ legendText: val })
                if (textInputRef.current) textInputRef.current.value = ''
              }}
            >
              <Icons.Plus className="w-3.5 h-3.5" /> Adicionar
            </Button>
          </div>

          {availableQuickPicks.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Já usados neste painel:</p>
              <div className="flex flex-wrap gap-1.5">
                {availableQuickPicks.map(q => (
                  <button
                    key={q.legendText}
                    type="button"
                    onClick={() => addRow(q)}
                    className="text-xs px-2 py-1 rounded-full border border-border hover:bg-muted transition-colors"
                  >
                    {q.legendText}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="cancel" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" size="sm">
            Salvar
          </Button>
        </div>
      </form>
    </div>
  )
}
