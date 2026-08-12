'use client'

import { useEffect, type RefObject } from 'react'
import { useRouter } from 'next/navigation'
import { Icons } from '@/lib/icons'
import { useShortcut } from '@/lib/keywatch'
import type { ShortcutSection } from '@/lib/keywatch'
import { useConfirm } from '@/lib/confirm-context'
import { findAnchoredBreakIds } from './useGanttEditor'
import type { GanttBoardHandle } from '../components/GanttBoard'
import type { PendingAddEntry } from '../components/AddTripModal'
import type { VehiclePlanGanttData } from '../views/vehicles.view'
import type { Selection } from '../engine/gantt.types'

// ── seções da modal de atalhos (ver docs/TODO.md) ────────────────────────────
const SEC_GERAL:   ShortcutSection = { label: 'Geral' } // sem hint — mesmo bucket do fallback "sem seção" em qualquer página
const SEC_PAINEIS: ShortcutSection = { label: 'Painéis', hint: 'Mostra/oculta painéis auxiliares do Gantt' }
const SEC_NAV_BLOCO:   ShortcutSection = { label: 'Navegação base', hint: 'Navegação entre viagens' }
const SEC_NAV_SENTIDO: ShortcutSection = { label: 'Navegação — sentido', hint: 'Navegação de viagens no mesmo sentido' }
const SEC_SELECAO: ShortcutSection = { label: 'Seleção de viagem', hint: 'Ações habilitadas quando existe seleção de viagens' }
const SEC_MOVER:   ShortcutSection = { label: 'Movimentação de bloco', hint: 'Só aparece com uma seleção de viagens ativa' }
const SEC_EDICAO:  ShortcutSection = {
  label: 'Edição de viagens',
  hint:  'Operações sob viagens e blocos',
}
const SEC_ACOES: ShortcutSection = { label: 'Ações rápidas', hint: 'Atalhos de contexto pra viagem focada' }

type NavItem  = { segId: string; dep: number }
type TripItem = { segId: string; dep: number; direction: string }

interface UseVehiclePlanShortcutsParams {
  canEdit:            boolean
  isNew:               boolean
  ganttBoardRef:        RefObject<GanttBoardHandle | null>
  shiftAnchorRef:       RefObject<string | null>

  selection:            Selection | null
  setSelection:         (sel: Selection | null) => void
  focusedSegId:         string | null
  setFocusedSegId:      (id: string | null) => void
  tripSeqAnchor:        string | null
  setTripSeqAnchor:     (id: string | null) => void
  moveTargetBlockId:    string | null
  setMoveTargetBlockId: (updater: (prev: string | null) => string | null) => void
  editBarOpen:          boolean
  selectedLineIds:      Set<string>
  navBlocks:            NavItem[][]
  allTrips:             TripItem[]
  mergedPlottedData:    VehiclePlanGanttData | null
  moveTargetBlocks:     { allBlockIds: string[]; sourceIndex: number } | null
  pendingAdds:          PendingAddEntry[]
  pendingDeletes:       Set<string>
  pendingDeadrunDeletes: Set<string>
  pendingIntervalDeletes: Set<string>
  setPendingAdds:        (updater: (prev: PendingAddEntry[]) => PendingAddEntry[]) => void
  setPendingDeletes:     (updater: (prev: Set<string>) => Set<string>) => void
  setPendingChanges:     (updater: (prev: Map<string, any>) => Map<string, any>) => void
  setPendingDeadrunDeletes: (updater: (prev: Set<string>) => Set<string>) => void
  setPendingDeadrunChanges: (updater: (prev: Map<string, any>) => Map<string, any>) => void
  pendingCount:         number

  setFreqPanelOpen:     (updater: (prev: boolean) => boolean) => void
  setAddTripOpen:       (v: boolean) => void
  setLineFreqOpen:      (updater: (prev: boolean) => boolean) => void
  setLinesPanelOpen:    (updater: (prev: boolean) => boolean) => void

  clearAllPending:            () => void
  handleSavePendingWithConfirm:    () => void
  handleDiscardPendingWithConfirm: () => void
  handleToggleEditBar:        () => void
  handleSelectionChange:      (sel: Selection | null) => void
  vehiclesActionSpec:          any
  stepMoveTarget:              (prev: string | null, dir: 1 | -1) => string | null
  handleConfirmMove:           () => void
  handleDistributeHeadway:     () => void
  handleTripTimingOp:          (op: 'grow' | 'shrink' | 'push' | 'pull' | 'growOnly' | 'shrinkOnly' | 'pushOnly' | 'pullOnly' | 'extendToNext') => void
  discardBreaks:               (ids: string[]) => void
}

export function useVehiclePlanShortcuts({
  canEdit, isNew, ganttBoardRef, shiftAnchorRef,
  selection, setSelection, focusedSegId, setFocusedSegId, tripSeqAnchor, setTripSeqAnchor,
  moveTargetBlockId, setMoveTargetBlockId, editBarOpen, selectedLineIds, navBlocks, allTrips,
  mergedPlottedData, moveTargetBlocks, pendingAdds, pendingDeletes, pendingDeadrunDeletes, pendingIntervalDeletes,
  setPendingAdds, setPendingDeletes, setPendingChanges, setPendingDeadrunDeletes, setPendingDeadrunChanges,
  pendingCount, setFreqPanelOpen, setAddTripOpen, setLineFreqOpen, setLinesPanelOpen,
  clearAllPending, handleSavePendingWithConfirm, handleDiscardPendingWithConfirm, handleToggleEditBar,
  handleSelectionChange, vehiclesActionSpec, stepMoveTarget, handleConfirmMove, handleDistributeHeadway,
  handleTripTimingOp, discardBreaks,
}: UseVehiclePlanShortcutsParams) {
  const router  = useRouter()
  const confirm = useConfirm()

  // ── keyboard nav focus ────────────────────────────────────────────────────

  useEffect(() => {
    if (!editBarOpen) {
      setFocusedSegId(null)
      setSelection(null)
      shiftAnchorRef.current = null
      return
    }
    const first = navBlocks[0]
    if (first?.length) setFocusedSegId(first[0].segId)
  }, [editBarOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── shortcuts ─────────────────────────────────────────────────────────────

  useShortcut('alt+v', () => {
    if (editBarOpen && pendingCount > 0) {
      confirm({
        title:        'Sair do modo de edição',
        description:  'Existem alterações pendentes que serão descartadas ao sair.',
        confirmLabel: 'Sair e descartar',
        variant:      'destructive',
      }).then(ok => {
        if (!ok) return
        clearAllPending()
        router.push('/transit/vehicle-plan')
      })
    } else {
      router.push('/transit/vehicle-plan')
    }
  }, {
    desc:    'Voltar',
    icon:    Icons.ArrowLeft,
    origin:  'apps/web/src/app/transit/vehicle-plan/[id]/page',
    context: 'all',
    section: SEC_GERAL,
  })

  useShortcut('ctrl+;', () => setFreqPanelOpen(v => !v), {
    desc:   'Frequência de atendimento',
    icon:   Icons.BarChart2,
    origin: 'apps/web/src/app/transit/vehicle-plan/[id]/page',
    section: SEC_PAINEIS,
  })

  useShortcut('alt+g', () => handleSavePendingWithConfirm(), {
    desc:    'Salvar alterações pendentes',
    icon:    Icons.Save,
    origin:  'apps/web/src/app/transit/vehicle-plan/[id]/page',
    enabled: editBarOpen,
    section: SEC_GERAL,
  })

  useShortcut('alt+l', () => handleDiscardPendingWithConfirm(), {
    desc:    'Reverte alterações pendentes',
    icon:    Icons.Undo2,
    origin:  'apps/web/src/app/transit/vehicle-plan/[id]/page',
    enabled: editBarOpen,
    section: SEC_GERAL,
  })

  useShortcut('alt+n', () => setAddTripOpen(true), {
    desc:    'Adicionar viagem',
    icon:    Icons.Plus,
    origin:  'apps/web/src/app/transit/vehicle-plan/[id]/page',
    enabled: editBarOpen && canEdit && selectedLineIds.size > 0,
    section: SEC_EDICAO,
  })

  useShortcut('f9', () => handleToggleEditBar(), {
    desc:    'Exibir/ocultar barra de edição',
    icon:    Icons.SlidersHorizontal,
    origin:  'apps/web/src/app/transit/vehicle-plan/[id]/page',
    enabled: !isNew,
    section: SEC_GERAL,
  })

  useShortcut('ctrl+.', () => setLineFreqOpen(v => !v), {
    desc:    'Painel de frequência da linha',
    icon:    Icons.LayoutList,
    origin:  'apps/web/src/app/transit/vehicle-plan/[id]/page',
    section: SEC_PAINEIS,
  })

  useShortcut('f6', () => setLinesPanelOpen(v => !v), {
    desc:    'Painel de linhas',
    icon:    Icons.List,
    origin:  'apps/web/src/app/transit/vehicle-plan/[id]/page',
    enabled: !isNew,
    section: SEC_PAINEIS,
  })

  // Bound to ctrl+enter instead of the physical ContextMenu key: Firefox refuses
  // to let preventDefault() suppress its native menu when triggered via keyboard
  // (Menu key / Shift+F10) — deliberate accessibility restriction, not a bug, and
  // not something fixable from JS. ctrl+enter has no browser default action to
  // fight, so it works identically everywhere.
  useShortcut('ctrl+enter', () => {
    if (!focusedSegId) return
    const segs = ganttBoardRef.current?.getSegments() ?? []
    const seg  = segs.find(s => s.id === focusedSegId)
    if (!seg) return
    const rows = ganttBoardRef.current?.getRows() ?? []
    handleSelectionChange(vehiclesActionSpec.resolveSelection(seg, selection, { allSegments: segs, allRows: rows }))
  }, {
    desc:    'Selecionar viagem focada',
    icon:    Icons.CheckSquare,
    origin:  'apps/web/src/app/transit/vehicle-plan/[id]/page',
    enabled: editBarOpen && !selection && !!focusedSegId,
    section: SEC_SELECAO,
  })

  useShortcut('←', () => {
    setSelection(null); shiftAnchorRef.current = null; setTripSeqAnchor(null)
    if (!focusedSegId) {
      const first = navBlocks.find(block => block.length > 0)?.[0]
      if (first) setFocusedSegId(first.segId)
      return
    }
    for (const block of navBlocks) {
      const idx = block.findIndex(i => i.segId === focusedSegId)
      if (idx > 0) { setFocusedSegId(block[idx - 1].segId); break }
      if (idx === 0) break
    }
  }, {
    desc:    'Viagem anterior no bloco',
    icon:    Icons.ArrowLeft,
    origin:  'apps/web/src/app/transit/vehicle-plan/[id]/page',
    enabled: editBarOpen && !selection,
    section: SEC_NAV_BLOCO,
  })

  useShortcut('→', () => {
    setSelection(null); shiftAnchorRef.current = null; setTripSeqAnchor(null)
    if (!focusedSegId) {
      const first = navBlocks.find(block => block.length > 0)?.[0]
      if (first) setFocusedSegId(first.segId)
      return
    }
    for (const block of navBlocks) {
      const idx = block.findIndex(i => i.segId === focusedSegId)
      if (idx !== -1 && idx < block.length - 1) { setFocusedSegId(block[idx + 1].segId); break }
      if (idx === block.length - 1) break
    }
  }, {
    desc:    'Próxima viagem no bloco',
    icon:    Icons.ArrowRight,
    origin:  'apps/web/src/app/transit/vehicle-plan/[id]/page',
    enabled: editBarOpen && !selection,
    section: SEC_NAV_BLOCO,
  })

  useShortcut('↑', () => {
    if (!focusedSegId) return
    setSelection(null); shiftAnchorRef.current = null; setTripSeqAnchor(null)
    for (let bi = 1; bi < navBlocks.length; bi++) {
      const idx = navBlocks[bi].findIndex(i => i.segId === focusedSegId)
      if (idx === -1) continue
      const curDep = navBlocks[bi][idx].dep
      const prev   = navBlocks[bi - 1]
      if (!prev.length) break
      const nearest = prev.reduce((best, item) =>
        Math.abs(item.dep - curDep) < Math.abs(best.dep - curDep) ? item : best
      )
      setFocusedSegId(nearest.segId)
      break
    }
  }, {
    desc:    'Bloco anterior (mesmo horário aproximado)',
    icon:    Icons.ArrowUp,
    origin:  'apps/web/src/app/transit/vehicle-plan/[id]/page',
    enabled: editBarOpen && !selection,
    section: SEC_NAV_BLOCO,
  })

  useShortcut('↓', () => {
    if (!focusedSegId) return
    setSelection(null); shiftAnchorRef.current = null; setTripSeqAnchor(null)
    for (let bi = 0; bi < navBlocks.length - 1; bi++) {
      const idx = navBlocks[bi].findIndex(i => i.segId === focusedSegId)
      if (idx === -1) continue
      const curDep = navBlocks[bi][idx].dep
      const next   = navBlocks[bi + 1]
      if (!next.length) break
      const nearest = next.reduce((best, item) =>
        Math.abs(item.dep - curDep) < Math.abs(best.dep - curDep) ? item : best
      )
      setFocusedSegId(nearest.segId)
      break
    }
  }, {
    desc:    'Próximo bloco (mesmo horário aproximado)',
    icon:    Icons.ArrowDown,
    origin:  'apps/web/src/app/transit/vehicle-plan/[id]/page',
    enabled: editBarOpen && !selection,
    section: SEC_NAV_BLOCO,
  })

  useShortcut('shift+←', () => {
    if (!focusedSegId) return
    if (!shiftAnchorRef.current) shiftAnchorRef.current = focusedSegId

    let nextFocus = focusedSegId
    for (const block of navBlocks) {
      const idx = block.findIndex(i => i.segId === focusedSegId)
      if (idx > 0)   { nextFocus = block[idx - 1].segId; break }
      if (idx === 0) break
    }
    setFocusedSegId(nextFocus)

    const segs   = ganttBoardRef.current?.getSegments() ?? []
    const anchor = segs.find(s => s.id === shiftAnchorRef.current!)
    const target = segs.find(s => s.id === nextFocus)
    if (!anchor || !target) return
    if (anchor.id === target.id) {
      setSelection({ type: 'trip', segment: anchor })
    } else if (anchor.rowId === target.rowId) {
      const rowId     = anchor.rowId
      const spanStart = Math.min(anchor.startMinute, target.startMinute)
      const spanEnd   = Math.max(anchor.endMinute,   target.endMinute)
      setSelection({
        type:     'interval',
        rowId,
        from:     anchor,
        to:       target,
        segments: segs.filter(s => s.rowId === rowId && s.endMinute > spanStart && s.startMinute < spanEnd),
      })
    }
  }, {
    desc:    'Estender seleção (bloco/intervalo)',
    icon:    Icons.ArrowLeft,
    origin:  'apps/web/src/app/transit/vehicle-plan/[id]/page',
    enabled: editBarOpen,
    section: SEC_SELECAO,
  })

  useShortcut('shift+→', () => {
    if (!focusedSegId) return
    if (!shiftAnchorRef.current) shiftAnchorRef.current = focusedSegId

    let nextFocus = focusedSegId
    for (const block of navBlocks) {
      const idx = block.findIndex(i => i.segId === focusedSegId)
      if (idx !== -1 && idx < block.length - 1) { nextFocus = block[idx + 1].segId; break }
      if (idx === block.length - 1)              break
    }
    setFocusedSegId(nextFocus)

    const segs   = ganttBoardRef.current?.getSegments() ?? []
    const anchor = segs.find(s => s.id === shiftAnchorRef.current!)
    const target = segs.find(s => s.id === nextFocus)
    if (!anchor || !target) return
    if (anchor.id === target.id) {
      setSelection({ type: 'trip', segment: anchor })
    } else if (anchor.rowId === target.rowId) {
      const rowId     = anchor.rowId
      const spanStart = Math.min(anchor.startMinute, target.startMinute)
      const spanEnd   = Math.max(anchor.endMinute,   target.endMinute)
      setSelection({
        type:     'interval',
        rowId,
        from:     anchor,
        to:       target,
        segments: segs.filter(s => s.rowId === rowId && s.endMinute > spanStart && s.startMinute < spanEnd),
      })
    }
  }, {
    desc:    'Estender seleção (bloco/intervalo)',
    icon:    Icons.ArrowRight,
    origin:  'apps/web/src/app/transit/vehicle-plan/[id]/page',
    enabled: editBarOpen,
    section: SEC_SELECAO,
  })

  // `selection` já é limpa pelo Escape nativo do GanttActionBar (só montado
  // quando há selection) — aqui só cuida do que mais nada trata: a âncora do
  // range de sequência (shift+pagedown/pageup), pra não duplicar o dismiss.
  useShortcut('esc', () => {
    setTripSeqAnchor(null)
  }, {
    desc:    'Limpa seleção de sequência',
    icon:    Icons.X,
    origin:  'apps/web/src/app/transit/vehicle-plan/[id]/page',
    enabled: editBarOpen && tripSeqAnchor != null,
    section: SEC_SELECAO,
  })

  // ── move-target navigation (Up/Down with active selection) ──────────────────

  const selectionHasTrips = selection
    ? (selection.type === 'trip'
        ? selection.segment.kind === 'trip'
        : selection.segments.some(s => s.kind === 'trip'))
    : false

  useShortcut('↑', () => {
    if (!moveTargetBlocks) return
    setTripSeqAnchor(null)
    setMoveTargetBlockId(prev => stepMoveTarget(prev, -1))
  }, {
    desc:    'Bloco alvo anterior',
    icon:    Icons.ArrowUp,
    origin:  'apps/web/src/app/transit/vehicle-plan/[id]/page',
    enabled: editBarOpen && selectionHasTrips,
    section: SEC_MOVER,
  })

  useShortcut('↓', () => {
    if (!moveTargetBlocks) return
    setTripSeqAnchor(null)
    setMoveTargetBlockId(prev => stepMoveTarget(prev, 1))
  }, {
    desc:    'Próximo bloco alvo',
    icon:    Icons.ArrowDown,
    origin:  'apps/web/src/app/transit/vehicle-plan/[id]/page',
    enabled: editBarOpen && selectionHasTrips,
    section: SEC_MOVER,
  })

  useShortcut('q+m', () => handleConfirmMove(), {
    desc:    'Mover viagens para bloco alvo',
    icon:    Icons.ArrowRightLeft,
    origin:  'apps/web/src/app/transit/vehicle-plan/[id]/page',
    enabled: editBarOpen && selectionHasTrips && !!moveTargetBlockId,
    section: SEC_MOVER,
  })

  useShortcut('pagedown', () => {
    if (!focusedSegId || focusedSegId.endsWith(':dr')) return
    setTripSeqAnchor(null)
    const curIdx = allTrips.findIndex(t => t.segId === focusedSegId)
    if (curIdx === -1) return
    const dir = allTrips[curIdx].direction
    for (let i = curIdx + 1; i < allTrips.length; i++) {
      if (allTrips[i].direction === dir) { setFocusedSegId(allTrips[i].segId); break }
    }
  }, {
    desc:    'Próxima viagem sentido',
    icon:    Icons.ArrowDown,
    origin:  'apps/web/src/app/transit/vehicle-plan/[id]/page',
    enabled: editBarOpen && !selection,
    section: SEC_NAV_SENTIDO,
  })

  useShortcut('shift+pagedown', () => {
    if (!focusedSegId || focusedSegId.endsWith(':dr')) return
    if (tripSeqAnchor == null) setTripSeqAnchor(focusedSegId)
    const curIdx = allTrips.findIndex(t => t.segId === focusedSegId)
    if (curIdx === -1) return
    const dir = allTrips[curIdx].direction
    for (let i = curIdx + 1; i < allTrips.length; i++) {
      if (allTrips[i].direction === dir) { setFocusedSegId(allTrips[i].segId); break }
    }
  }, {
    desc:    'Estende seleção até próxima viagem mesmo sentido',
    icon:    Icons.ArrowDown,
    origin:  'apps/web/src/app/transit/vehicle-plan/[id]/page',
    enabled: editBarOpen && !selection,
    section: SEC_SELECAO,
  })

  useShortcut('pageup', () => {
    if (!focusedSegId || focusedSegId.endsWith(':dr')) return
    setTripSeqAnchor(null)
    const curIdx = allTrips.findIndex(t => t.segId === focusedSegId)
    if (curIdx === -1) return
    const dir = allTrips[curIdx].direction
    for (let i = curIdx - 1; i >= 0; i--) {
      if (allTrips[i].direction === dir) { setFocusedSegId(allTrips[i].segId); break }
    }
  }, {
    desc:    'Viagem anterior mesmo sentido',
    icon:    Icons.ArrowUp,
    origin:  'apps/web/src/app/transit/vehicle-plan/[id]/page',
    enabled: editBarOpen && !selection,
    section: SEC_NAV_SENTIDO,
  })

  useShortcut('shift+pageup', () => {
    if (!focusedSegId || focusedSegId.endsWith(':dr')) return
    if (tripSeqAnchor == null) setTripSeqAnchor(focusedSegId)
    const curIdx = allTrips.findIndex(t => t.segId === focusedSegId)
    if (curIdx === -1) return
    const dir = allTrips[curIdx].direction
    for (let i = curIdx - 1; i >= 0; i--) {
      if (allTrips[i].direction === dir) { setFocusedSegId(allTrips[i].segId); break }
    }
  }, {
    desc:    'Estende seleção até viagem anterior mesmo sentido',
    icon:    Icons.ArrowUp,
    origin:  'apps/web/src/app/transit/vehicle-plan/[id]/page',
    enabled: editBarOpen && !selection,
    section: SEC_SELECAO,
  })

  useShortcut('q+ ', () => handleDistributeHeadway(), {
    desc:    'Distribuir frequência viagens',
    icon:    Icons.AlignHorizontalDistributeCenter,
    origin:  'apps/web/src/app/transit/vehicle-plan/[id]/page',
    enabled: editBarOpen && canEdit && !selection,
    preventDefault: true,
    section: SEC_SELECAO,
  })

  useShortcut('home', () => {
    const first = navBlocks[0]?.[0]
    if (first) { setFocusedSegId(first.segId); setSelection(null); shiftAnchorRef.current = null }
  }, {
    desc:    'Primeiro item do dia (por bloco)',
    icon:    Icons.ArrowLeft,
    origin:  'apps/web/src/app/transit/vehicle-plan/[id]/page',
    enabled: editBarOpen && !selection,
    section: SEC_NAV_BLOCO,
  })

  useShortcut('end', () => {
    const lastBlock = navBlocks[navBlocks.length - 1]
    const last = lastBlock?.[lastBlock.length - 1]
    if (last) { setFocusedSegId(last.segId); setSelection(null); shiftAnchorRef.current = null }
  }, {
    desc:    'Último item do dia (por bloco)',
    icon:    Icons.ArrowRight,
    origin:  'apps/web/src/app/transit/vehicle-plan/[id]/page',
    enabled: editBarOpen && !selection,
    section: SEC_NAV_BLOCO,
  })

  useShortcut('shift+home', () => {
    if (!focusedSegId || focusedSegId.endsWith(':dr')) return
    const curIdx = allTrips.findIndex(t => t.segId === focusedSegId)
    if (curIdx === -1) return
    const dir = allTrips[curIdx].direction
    const first = allTrips.find(t => t.direction === dir)
    if (first) setFocusedSegId(first.segId)
  }, {
    desc:    'Primeira viagem do sentido',
    icon:    Icons.ArrowLeft,
    origin:  'apps/web/src/app/transit/vehicle-plan/[id]/page',
    enabled: editBarOpen && !selection,
    section: SEC_NAV_SENTIDO,
  })

  useShortcut('shift+end', () => {
    if (!focusedSegId || focusedSegId.endsWith(':dr')) return
    const curIdx = allTrips.findIndex(t => t.segId === focusedSegId)
    if (curIdx === -1) return
    const dir = allTrips[curIdx].direction
    for (let i = allTrips.length - 1; i >= 0; i--) {
      if (allTrips[i].direction === dir) { setFocusedSegId(allTrips[i].segId); break }
    }
  }, {
    desc:    'Última viagem do sentido',
    icon:    Icons.ArrowRight,
    origin:  'apps/web/src/app/transit/vehicle-plan/[id]/page',
    enabled: editBarOpen && !selection,
    section: SEC_NAV_SENTIDO,
  })

  // ── trip timing shortcuts (edit bar, single-trip focus) ──────────────────
  const isTripFocused  = editBarOpen && !!focusedSegId && !focusedSegId.endsWith(':dr')
  const isBreakFocused = editBarOpen && !!focusedSegId && focusedSegId.endsWith(':bk')

  const editOrigin = 'apps/web/src/app/transit/vehicle-plan/[id]/page'
  useShortcut('+',              () => handleTripTimingOp('grow'),      { desc: 'Crescer viagem (propaga)',                      icon: Icons.Plus,               origin: editOrigin, enabled: isTripFocused, section: SEC_EDICAO })
  useShortcut('-',              () => handleTripTimingOp('shrink'),    { desc: 'Encolher viagem  (propaga)',                    icon: Icons.MinusSquare,        origin: editOrigin, enabled: isTripFocused, section: SEC_EDICAO })
  useShortcut(' ',              () => handleTripTimingOp('push'),      { desc: 'Empurrar viagem (propaga)',                     icon: Icons.ArrowRightFromLine, origin: editOrigin, enabled: isTripFocused, preventDefault: true, section: SEC_EDICAO })
  useShortcut('backspace',      () => handleTripTimingOp('pull'),      { desc: 'Puxar viagem (propaga)',                        icon: Icons.ArrowLeft,          origin: editOrigin, enabled: isTripFocused, preventDefault: true, section: SEC_EDICAO })
  useShortcut('shift++',        () => handleTripTimingOp('growOnly'),  { desc: 'Crescer viagem',                                icon: Icons.Plus,               origin: editOrigin, enabled: isTripFocused, section: SEC_EDICAO })
  useShortcut('shift+-',        () => handleTripTimingOp('shrinkOnly'),{ desc: 'Encolher viagem',                               icon: Icons.MinusSquare,        origin: editOrigin, enabled: isTripFocused, section: SEC_EDICAO })
  useShortcut('shift+ ',        () => handleTripTimingOp('pushOnly'),  { desc: 'Empurrar só o início',                          icon: Icons.ArrowRightFromLine, origin: editOrigin, enabled: isTripFocused, preventDefault: true, section: SEC_EDICAO })
  useShortcut('shift+backspace',() => handleTripTimingOp('pullOnly'),  { desc: 'Puxar só o início',                             icon: Icons.ArrowLeft,          origin: editOrigin, enabled: isTripFocused, preventDefault: true, section: SEC_EDICAO })

  // Extends the focused break up to the next item in the block (trip, deadrun or
  // another break), minus 1min, capped at its IntervalType.maxMinutes.
  useShortcut('q+ ', () => handleTripTimingOp('extendToNext'), { desc: 'Estender intervalo até o próximo item', icon: Icons.Coffee, origin: editOrigin, enabled: isBreakFocused, preventDefault: true, section: SEC_EDICAO })

  // Direct shortcuts for context-bar actions on the focused trip — resolves and
  // filters through the exact same vehiclesActionSpec the bar itself uses, so
  // eligibility (canAddAccess/canAddReturn/canAddInterval) always matches what
  // would actually be shown; outside that eligibility it's a silent no-op.
  function triggerFocusedTripAction(actionId: string) {
    if (!focusedSegId || !mergedPlottedData) return
    const segs = ganttBoardRef.current?.getSegments() ?? []
    const seg  = segs.find(s => s.id === focusedSegId)
    if (!seg) return
    const rows     = ganttBoardRef.current?.getRows() ?? []
    const resolved = vehiclesActionSpec.resolveSelection(seg, null, { allSegments: segs, allRows: rows })
    if (!resolved) return
    const actions = vehiclesActionSpec.getActions(resolved, mergedPlottedData, () => {})
    actions.find((a: any) => a.id === actionId)?.onClick()
  }

  useShortcut('q+l', () => triggerFocusedTripAction('lock'),         { desc: 'Bloquear/desbloquear viagem', icon: Icons.Lock,   origin: editOrigin, enabled: isTripFocused, section: SEC_ACOES })
  useShortcut('q+e', () => triggerFocusedTripAction('access'),       { desc: 'Adicionar acesso',            icon: Icons.MapPin, origin: editOrigin, enabled: isTripFocused, section: SEC_ACOES })
  useShortcut('q+r', () => triggerFocusedTripAction('return'),       { desc: 'Adicionar recolhida',         icon: Icons.Truck,  origin: editOrigin, enabled: isTripFocused, section: SEC_ACOES })
  useShortcut('q+i', () => triggerFocusedTripAction('add-interval'), { desc: 'Adicionar intervalo',         icon: Icons.Coffee, origin: editOrigin, enabled: isTripFocused, section: SEC_ACOES })

  useShortcut('delete', () => {
    if (!canEdit || !mergedPlottedData) return

    // Build list of segment references: prefer active selection, fall back to focusedSegId
    type SegKind = 'trip' | 'deadrun' | 'break'
    type SegRef  = { id: string; kind: SegKind }
    let segRefs: SegRef[] = []
    if (selection) {
      const segs = selection.type === 'trip' ? [selection.segment] : selection.segments
      segRefs = segs.map(s => ({ id: s.id, kind: s.kind === 'deadhead' ? 'deadrun' : s.kind === 'break' ? 'break' : 'trip' }))
    } else if (focusedSegId) {
      const kind: SegKind = focusedSegId.endsWith(':dr') ? 'deadrun' : focusedSegId.endsWith(':bk') ? 'break' : 'trip'
      segRefs = [{ id: focusedSegId, kind }]
    }
    if (segRefs.length === 0) return

    const tripIds:    string[] = []
    const tempIds:    string[] = []
    const deadrunIds: string[] = []
    const breakIds:   string[] = []

    for (const { id, kind } of segRefs) {
      if (kind === 'deadrun') {
        deadrunIds.push(id.replace(/:dr$/, ''))
      } else if (kind === 'break') {
        breakIds.push(id.replace(/:bk$/, ''))
      } else {
        for (const block of mergedPlottedData.blocks) {
          const bt = block.blockTrips.find(bt => bt.id === id)
          if (bt) {
            const isTemp = pendingAdds.some(a => a._kind === 'trip' && a._tempId === bt.id)
            if (isTemp) tempIds.push(bt.id)
            else        tripIds.push(bt.trip.id)
            break
          }
        }
      }
    }

    // Trips being deleted take their attached interval (if any) along with them —
    // positional link, no FK, see docs/proposal/vehicle-plan-block-intervals.md §7.1.
    if (tripIds.length > 0) {
      for (const block of mergedPlottedData.blocks) {
        for (const bkId of findAnchoredBreakIds(block, tripIds)) {
          if (!breakIds.includes(bkId)) breakIds.push(bkId)
        }
      }
    }

    // Compute next focus before applying state
    let nextFocusId: string | null = null
    if (focusedSegId) {
      const deletedSegIds  = new Set(segRefs.map(r => r.id))
      const newTripDels    = new Set([...pendingDeletes,         ...tripIds])
      const newDrDels      = new Set([...pendingDeadrunDeletes,  ...deadrunIds])
      const newBkDels      = new Set([...pendingIntervalDeletes, ...breakIds])
      for (const t of tempIds) deletedSegIds.add(t)  // pending-add blockTrip IDs

      let foundBlock: typeof mergedPlottedData.blocks[0] | null = null
      let focusedDep = 0
      for (const block of mergedPlottedData.blocks) {
        const bt = block.blockTrips.find(bt => bt.id === focusedSegId)
        if (bt) { foundBlock = block; focusedDep = bt.trip.departureMinutes; break }
        const dr = block.blockDeadruns.find(dr => `${dr.id}:dr` === focusedSegId)
        if (dr) { foundBlock = block; focusedDep = dr.departureMinutes; break }
        const bi = block.blockIntervals.find(bi => `${bi.id}:bk` === focusedSegId)
        if (bi) { foundBlock = block; focusedDep = bi.departureMinutes; break }
      }

      if (foundBlock) {
        const remaining = [
          ...foundBlock.blockTrips
            .filter(bt => !deletedSegIds.has(bt.id) && !newTripDels.has(bt.trip.id))
            .map(bt => ({ id: bt.id, dep: bt.trip.departureMinutes })),
          ...foundBlock.blockDeadruns
            .filter(dr => !deletedSegIds.has(`${dr.id}:dr`) && !newDrDels.has(dr.id))
            .map(dr => ({ id: `${dr.id}:dr`, dep: dr.departureMinutes })),
          ...foundBlock.blockIntervals
            .filter(bi => !deletedSegIds.has(`${bi.id}:bk`) && !newBkDels.has(bi.id))
            .map(bi => ({ id: `${bi.id}:bk`, dep: bi.departureMinutes })),
        ]

        if (remaining.length > 0) {
          nextFocusId = remaining.reduce((best, cur) =>
            Math.abs(cur.dep - focusedDep) < Math.abs(best.dep - focusedDep) ? cur : best
          ).id
        } else {
          const allOther = mergedPlottedData.blocks
            .filter(b => b !== foundBlock)
            .flatMap(b => b.blockTrips
              .filter(bt => !newTripDels.has(bt.trip.id))
              .map(bt => ({ id: bt.id, dep: bt.trip.departureMinutes }))
            )
          if (allOther.length > 0) {
            nextFocusId = allOther.reduce((best, cur) =>
              Math.abs(cur.dep - focusedDep) < Math.abs(best.dep - focusedDep) ? cur : best
            ).id
          }
        }
      }
    }

    if (tempIds.length > 0)
      setPendingAdds(prev => prev.filter(a => !tempIds.includes(a._tempId)))

    if (tripIds.length > 0) {
      setPendingDeletes(prev => new Set([...prev, ...tripIds]))
      setPendingChanges(prev => {
        const next = new Map(prev)
        for (const tid of tripIds) next.delete(tid)
        return next
      })
    }

    if (deadrunIds.length > 0) {
      setPendingDeadrunDeletes(prev => new Set([...prev, ...deadrunIds]))
      setPendingDeadrunChanges(prev => {
        const next = new Map(prev)
        for (const did of deadrunIds) next.delete(did)
        return next
      })
    }

    discardBreaks(breakIds)

    setFocusedSegId(nextFocusId)
    setSelection(null)
  }, {
    desc:    'Excluir',
    icon:    Icons.Trash2,
    origin:  'apps/web/src/app/transit/vehicle-plan/[id]/page',
    enabled: editBarOpen && (!!selection || !!focusedSegId),
    preventDefault: true,
    section: SEC_EDICAO,
  })
}
