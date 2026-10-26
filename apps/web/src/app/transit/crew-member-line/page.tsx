'use client'

import { useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Icons }            from '@/lib/icons'
import { AutoBreadcrumb }   from '@/core/AutoBreadcrumb'
import { usePageGuard }     from '@/core/usePageGuard'
import { Combobox, type ComboboxOption } from '@/components/ui/combobox'
import { useTopbarActions } from '@/components/layout/topbar-actions-context'
import { useShortcut }      from '@/lib/keywatch'
import { apiFetch }         from '@/lib/auth'
import { useToast }         from '@/lib/toast-context'
import { cn, extractError } from '@/lib/utils'

const ORIGIN  = 'apps/web/src/app/transit/crew-member-line/page'
const FORM_ID = 'crew-lines-form'

// The operator's lines (CrewMemberLine) as one board: every line his empresa operates, by line
// group. One click toggles the state that matters in the empresa's mode (enabled in
// "habilitadas", blocked in "bloqueadas"); the ★ makes it the next preference; the ◆ makes it a
// priority line of the empresa (no limit, weighs before his preferences in the generator, the crew
// portal can't change it). The plantão is one more item (STANDBY): allowed unless blocked, whatever
// the mode, and rankable. Saved at once.

interface Board {
  lineAccessMode:    'WHITELIST' | 'BLACKLIST'
  maxPreferredLines: number
  lines:   { id: string; code: string; name: string; groups: { id: string; name: string }[] }[]
  entries: { lineId: string; access: 'ENABLED' | 'BLOCKED' | null; rank: number | null; priority: boolean }[]
  standby: { blocked: boolean; rank: number | null }
}

// prefs may hold STANDBY (the plantão's place among the preferred lines); prio: the empresa's
// priority lines
interface Draft { on: string[]; prefs: string[]; prio: string[]; standbyBlocked: boolean }

const STANDBY = '__STANDBY__'

const MODE_TEXT = {
  WHITELIST: 'WHITELIST • bloqueia todas',
  BLACKLIST: 'BLACKLIST • libera todas',
}

async function fetchBoard(crewMemberId: string): Promise<Board> {
  const res = await apiFetch(`/transit/crew-member-line/board/${crewMemberId}`)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(extractError(json))
  return json
}

// the board's rows as the draft: lines marked in the mode, preferences in rank order
function draftOf(board: Board, entries = board.entries, standby = board.standby): Draft {
  const mark = board.lineAccessMode === 'WHITELIST' ? 'ENABLED' : 'BLOCKED'
  const known = new Set(board.lines.map(l => l.id))
  const on = entries.filter(e => e.access === mark && known.has(e.lineId)).map(e => e.lineId)
  const operable = (id: string) => board.lineAccessMode === 'WHITELIST' ? on.includes(id) : !on.includes(id)
  const prefs = [
    ...entries.filter(e => e.rank != null && known.has(e.lineId) && operable(e.lineId)),
    ...(standby.rank != null && !standby.blocked ? [{ lineId: STANDBY, rank: standby.rank }] : []),
  ]
    .sort((a, b) => a.rank! - b.rank!)
    .map(e => e.lineId)
    .slice(0, board.maxPreferredLines)
  const prio = entries.filter(e => e.priority && known.has(e.lineId) && operable(e.lineId)).map(e => e.lineId)
  return { on, prefs, prio, standbyBlocked: standby.blocked }
}

export default function CrewMemberLinesPage() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const queryClient  = useQueryClient()
  const { toast }    = useToast()
  const crewMemberId = searchParams.get('crewMemberId') ?? ''
  const { guardNode, canUpdate } = usePageGuard('transit', 'crew-member-line')

  const { data: board } = useQuery<Board>({
    queryKey: ['transit', 'crew-member-line', 'board', crewMemberId],
    queryFn:  () => fetchBoard(crewMemberId),
    enabled:  !!crewMemberId,
  })

  // null = untouched (follows the server)
  const [edit, setEdit]     = useState<Draft | null>(null)
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const draft = edit ?? (board ? draftOf(board) : { on: [], prefs: [], prio: [], standbyBlocked: false })
  const dirty = !!board && !!edit && JSON.stringify(edit) !== JSON.stringify(draftOf(board))

  const whitelist = board?.lineAccessMode === 'WHITELIST'
  const operable  = (id: string, d = draft) => id === STANDBY ? !d.standbyBlocked : whitelist ? d.on.includes(id) : !d.on.includes(id)
  const lineById  = useMemo(() => new Map([
    ...(board?.lines ?? []).map(l => [l.id, l] as const),
    [STANDBY, { id: STANDBY, code: 'Plantão', name: 'Plantão (reserva)', groups: [] }] as const,
  ]), [board])

  function toggleStandby() {
    const next = { ...draft, standbyBlocked: !draft.standbyBlocked }
    setEdit({ ...next, prefs: next.prefs.filter(id => operable(id, next)) })
  }

  function toggle(ids: string[], on: boolean) {
    const set = new Set(draft.on)
    for (const id of ids) { if (on) set.add(id); else set.delete(id) }
    const next = { ...draft, on: [...set] }
    setEdit({ ...next, prefs: next.prefs.filter(id => operable(id, next)), prio: next.prio.filter(id => operable(id, next)) })
  }

  // a priority line must be operable — marking one enables it (whitelist) / unblocks it (blacklist)
  function prioritize(id: string) {
    if (draft.prio.includes(id)) return setEdit({ ...draft, prio: draft.prio.filter(p => p !== id) })
    const on = whitelist ? [...new Set([...draft.on, id])] : draft.on.filter(x => x !== id)
    setEdit({ ...draft, on, prio: [...draft.prio, id] })
  }

  function star(id: string) {
    if (draft.prefs.includes(id)) return setEdit({ ...draft, prefs: draft.prefs.filter(p => p !== id) })
    if (!board || draft.prefs.length >= board.maxPreferredLines || !operable(id)) return
    setEdit({ ...draft, prefs: [...draft.prefs, id] })
  }

  // drag a preference onto another position: it moves there, the others shift
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  function movePref(from: number, to: number) {
    const prefs = [...draft.prefs]
    const [id] = prefs.splice(from, 1)
    prefs.splice(Math.min(to, prefs.length), 0, id)
    setEdit({ ...draft, prefs })
  }

  // lines matching the search, by group (a line in two groups shows in both)
  const sections = useMemo(() => {
    if (!board) return []
    const q = search.trim().toLowerCase()
    const match = board.lines.filter(l => !q || l.code.toLowerCase().includes(q) || l.name.toLowerCase().includes(q))
    const groups = new Map<string, { name: string; lines: Board['lines'] }>()
    const loose: Board['lines'] = []
    for (const l of match) {
      if (!l.groups.length) loose.push(l)
      for (const g of l.groups) {
        const s = groups.get(g.id) ?? { name: g.name, lines: [] }
        s.lines.push(l)
        groups.set(g.id, s)
      }
    }
    const out = [...groups.entries()].map(([id, s]) => ({ id, ...s })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    if (loose.length) out.push({ id: '-', name: out.length ? 'Sem grupo' : 'Linhas', lines: loose })
    return out
  }, [board, search])
  const visibleIds = [...new Set(sections.flatMap(s => s.lines.map(l => l.id)))]

  async function handleSave(e?: React.FormEvent) {
    e?.preventDefault()
    if (!board || !dirty || saving) return
    setSaving(true)
    try {
      const mark = whitelist ? 'ENABLED' : 'BLOCKED'
      const ids = new Set([...draft.on, ...draft.prefs.filter(id => id !== STANDBY), ...draft.prio])
      const entries = [...ids].map(lineId => ({
        lineId,
        access:   draft.on.includes(lineId) ? mark : null,
        rank:     draft.prefs.includes(lineId) ? draft.prefs.indexOf(lineId) + 1 : null,
        priority: draft.prio.includes(lineId),
      }))
      const standby = { blocked: draft.standbyBlocked, rank: draft.prefs.includes(STANDBY) ? draft.prefs.indexOf(STANDBY) + 1 : null }
      const res  = await apiFetch(`/transit/crew-member-line/board/${crewMemberId}`, { method: 'PUT', body: JSON.stringify({ entries, standby }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(extractError(json))
      queryClient.setQueryData(['transit', 'crew-member-line', 'board', crewMemberId], json)
      setEdit(null)
      toast.success('Linhas gravadas')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao gravar')
    } finally {
      setSaving(false)
    }
  }

  // ── copy from another operator ──
  const [copySearch, setCopySearch] = useState('')
  const { data: copyOptions = [], isLoading: copyLoading } = useQuery<ComboboxOption[]>({
    queryKey: ['transit', 'crew-member', 'search', copySearch],
    queryFn:  async () => {
      const res = await apiFetch(`/transit/crew-member?pageSize=20&search=${encodeURIComponent(copySearch)}`)
      if (!res.ok) return []
      const json = await res.json()
      return (json.data ?? []).filter((m: { id: string }) => m.id !== crewMemberId).map((m: { id: string; displayName?: string }) => ({ id: m.id, label: m.displayName ?? m.id }))
    },
    enabled: copySearch.trim().length > 0,
  })
  async function copyFrom(option: ComboboxOption | null) {
    setCopySearch('')
    if (!option || !board) return
    try {
      const other = await fetchBoard(option.id)
      setEdit(draftOf(board, other.lineAccessMode === board.lineAccessMode ? other.entries : other.entries.filter(e => e.rank != null).map(e => ({ ...e, access: null })), other.standby))
      toast.success(`Linhas copiadas de ${option.label} — grave para confirmar`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao copiar')
    }
  }

  const back = () => router.push(`/transit/crew-member/${crewMemberId}`)
  useTopbarActions(canUpdate ? [
    { label: saving ? 'Gravar…' : 'Gravar', icon: Icons.Save, type: 'submit', form: FORM_ID, primary: true, disabled: saving || !dirty, keybind: 'ALT+G' },
  ] : [], [canUpdate, saving, dirty])
  useShortcut('alt+g', () => void handleSave(), { desc: 'Gravar linhas', icon: Icons.Save, origin: ORIGIN, context: 'all' })
  useShortcut('alt+v', back, { desc: 'Voltar', icon: Icons.ArrowLeft, origin: ORIGIN, context: 'all' })
  useShortcut('alt+l', () => setEdit(null), { display: false, origin: ORIGIN })

  if (guardNode) return guardNode
  const readonly = !canUpdate

  return (
    <form id={FORM_ID} onSubmit={handleSave} className="p-6 space-y-5">
      <AutoBreadcrumb domain="transit" resource="crew-member-line" contextParams={{ crewMemberId }} />

      {!board ? <p className="text-sm text-muted-foreground">Carregando…</p> : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-muted-foreground mr-auto">METODOLOGIA: <span className="text-foreground">{MODE_TEXT[board.lineAccessMode]}</span></p>
            <div className="relative">
              <Icons.Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar linha…" autoFocus
                className="h-8 w-52 pl-8 pr-2 border border-input rounded-sm text-sm bg-input-bg focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            {!readonly && (
              <Combobox
                value={null} displayValue="" search={copySearch} onSearchChange={setCopySearch}
                options={copyOptions} isLoading={copyLoading} onSelect={(o) => void copyFrom(o)}
                placeholder="Copiar de…" className="h-8 text-sm" containerClassName="w-60"
                emptyMessage={copySearch ? 'Nenhum operador' : 'Digite matrícula ou nome'}
              />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium w-24">Prioritárias</span>
            {draft.prio.map(id => {
              const line = lineById.get(id)
              return (
                <span key={id} className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-sm border border-sky-500/60 bg-sky-500/10 text-sm">
                  {line?.code ?? '—'}
                  {!readonly && (
                    <button type="button" onClick={() => prioritize(id)} title="Tirar das prioritárias" className="text-muted-foreground hover:text-foreground">
                      <Icons.X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </span>
              )
            })}
            {!draft.prio.length && <span className="inline-flex items-center h-8 px-2.5 rounded-sm border border-dashed border-border text-sm text-muted-foreground">—</span>}
            <span className="text-xs text-muted-foreground">◆ definidas pela empresa · sem limite · o gerador considera antes das preferidas · o operador não altera</span>
          </div>

          {board.maxPreferredLines > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium w-24">Preferidas</span>
              {Array.from({ length: board.maxPreferredLines }, (_, i) => {
                const id = draft.prefs[i]
                const line = id ? lineById.get(id) : null
                const draggable = !!line && !readonly
                return (
                  <span
                    key={i}
                    draggable={draggable}
                    onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDragFrom(i) }}
                    onDragEnd={() => { setDragFrom(null); setDragOver(null) }}
                    onDragOver={(e) => { if (dragFrom == null) return; e.preventDefault(); setDragOver(i) }}
                    onDragLeave={() => setDragOver(o => (o === i ? null : o))}
                    onDrop={(e) => { e.preventDefault(); if (dragFrom != null && dragFrom !== i) movePref(dragFrom, i); setDragFrom(null); setDragOver(null) }}
                    title={draggable ? 'Arraste para mudar a ordem' : undefined}
                    className={cn(
                      'inline-flex items-center gap-1.5 h-8 px-2.5 rounded-sm border text-sm transition-colors',
                      line ? 'border-amber-500/60 bg-amber-500/10' : 'border-dashed border-border text-muted-foreground',
                      draggable && 'cursor-grab active:cursor-grabbing',
                      dragFrom === i && 'opacity-40',
                      dragOver === i && dragFrom !== i && 'ring-2 ring-ring',
                    )}
                  >
                    {draggable && <Icons.GripVertical className="w-3.5 h-3.5 -ml-1 text-muted-foreground/60" />}
                    <span className="text-xs text-muted-foreground">{i + 1}º</span>
                    {line ? line.code : '—'}
                    {line && !readonly && (
                      <button type="button" onClick={() => star(line.id)} title="Tirar das preferidas" className="text-muted-foreground hover:text-foreground">
                        <Icons.X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </span>
                )
              })}
              <span className="text-xs text-muted-foreground">★ preferencial · arraste para reordenar</span>
            </div>
          )}

          <div className="flex items-center gap-3 text-xs">
            <span className="text-muted-foreground">{draft.on.length} {whitelist ? 'habilitada(s)' : 'bloqueada(s)'} de {board.lines.length}</span>
            {!readonly && (
              <>
                <button type="button" onClick={() => toggle(visibleIds, true)} className="font-medium hover:underline">{whitelist ? 'Habilitar' : 'Bloquear'} todas</button>
                <button type="button" onClick={() => toggle(visibleIds, false)} className="font-medium hover:underline">Nenhuma</button>
                {search && <span className="text-muted-foreground">(as da busca)</span>}
              </>
            )}
          </div>

          <section className="space-y-2">
            <h2 className="text-sm font-medium">Plantão</h2>
            <div className="flex flex-wrap items-center gap-2">
              {(() => {
                const rank = draft.prefs.indexOf(STANDBY) + 1
                const canStar = !draft.standbyBlocked && (rank > 0 || draft.prefs.length < board.maxPreferredLines)
                return (
                  <span className={cn(
                    'inline-flex items-center h-8 rounded-sm border text-sm transition-colors',
                    draft.standbyBlocked ? 'border-red-500/60 bg-red-500/15 text-muted-foreground line-through' : 'border-cyan-500/60 bg-cyan-500/10',
                  )}>
                    <button type="button" disabled={readonly} onClick={toggleStandby} title={draft.standbyBlocked ? 'Não faz plantão — clique para liberar' : 'Faz plantão — clique para bloquear'}
                      className="h-full pl-2.5 pr-1.5 font-medium disabled:cursor-default">
                      Plantão
                    </button>
                    {board.maxPreferredLines > 0 && (
                      <button
                        type="button" disabled={readonly || !canStar} onClick={() => star(STANDBY)}
                        title={rank ? `${rank}ª preferência — clique para tirar` : 'Tornar preferência'}
                        className={cn('h-full pr-2 pl-0.5 text-xs disabled:opacity-30 disabled:cursor-default', rank ? 'text-amber-500' : 'text-muted-foreground/60 hover:text-amber-500')}
                      >
                        {rank ? `★${rank}` : '☆'}
                      </button>
                    )}
                  </span>
                )
              })()}
              <span className="text-xs text-muted-foreground">Liberado para todos, em qualquer modo — clique para bloquear; ★ coloca o plantão entre as preferências</span>
            </div>
          </section>

          {sections.length === 0 && <p className="text-sm text-muted-foreground">{board.lines.length ? 'Nenhuma linha na busca.' : 'A empresa do operador não opera nenhuma linha ativa.'}</p>}

          {sections.map(section => (
            <section key={section.id} className="space-y-2">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-medium">{section.name}</h2>
                {!readonly && (
                  <span className="flex gap-2 text-xs text-muted-foreground">
                    <button type="button" onClick={() => toggle(section.lines.map(l => l.id), true)} className="hover:text-foreground hover:underline">todas</button>
                    <button type="button" onClick={() => toggle(section.lines.map(l => l.id), false)} className="hover:text-foreground hover:underline">nenhuma</button>
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {section.lines.map(l => {
                  const on = draft.on.includes(l.id)
                  const rank = draft.prefs.indexOf(l.id) + 1
                  const prio = draft.prio.includes(l.id)
                  const canStar = operable(l.id) && (rank > 0 || draft.prefs.length < board.maxPreferredLines)
                  return (
                    <span
                      key={l.id}
                      className={cn(
                        'inline-flex items-center h-8 rounded-sm border text-sm transition-colors',
                        on && whitelist  && 'border-emerald-500/60 bg-emerald-500/15',
                        on && !whitelist && 'border-red-500/60 bg-red-500/15 text-muted-foreground line-through',
                        !on && 'border-border',
                      )}
                    >
                      <button
                        type="button" disabled={readonly} title={l.name}
                        onClick={() => toggle([l.id], !on)}
                        className="h-full pl-2.5 pr-1.5 font-medium tabular-nums disabled:cursor-default"
                      >
                        {l.code}
                      </button>
                      {board.maxPreferredLines > 0 && (
                        <button
                          type="button" disabled={readonly || !canStar} onClick={() => star(l.id)}
                          title={rank ? `${rank}ª preferida — clique para tirar` : 'Tornar preferida'}
                          className={cn('h-full pl-0.5 text-xs disabled:opacity-30 disabled:cursor-default', rank ? 'text-amber-500' : 'text-muted-foreground/60 hover:text-amber-500')}
                        >
                          {rank ? `★${rank}` : '☆'}
                        </button>
                      )}
                      <button
                        type="button" disabled={readonly} onClick={() => prioritize(l.id)}
                        title={prio ? 'Prioritária da empresa — clique para tirar' : 'Tornar prioritária (empresa)'}
                        className={cn('h-full pr-2 pl-1 text-xs disabled:opacity-30 disabled:cursor-default', prio ? 'text-sky-500' : 'text-muted-foreground/60 hover:text-sky-500')}
                      >
                        {prio ? '◆' : '◇'}
                      </button>
                    </span>
                  )
                })}
              </div>
            </section>
          ))}
        </>
      )}
    </form>
  )
}
