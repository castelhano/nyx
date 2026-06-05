'use client'

import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/auth'
import { Icons }    from '@/lib/icons'

interface PlanLine {
  lineId: string
  line:   { id: string; code: string; name: string }
}

interface LineGroup {
  id:      string
  name:    string
  lineIds: string[]
}

interface Props {
  planLines:         PlanLine[]
  selectedLineIds:   Set<string>
  onSelectionChange: (ids: Set<string>) => void
  onClose:           () => void
}

export function LinesPanel({ planLines, selectedLineIds, onSelectionChange, onClose }: Props) {
  const [search,   setSearch]   = useState('')
  const [groupId,  setGroupId]  = useState('')
  const [bulkOpen, setBulkOpen] = useState(false)
  const bulkRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!bulkOpen) return
    function onOutside(e: MouseEvent) {
      if (bulkRef.current && !bulkRef.current.contains(e.target as Node)) setBulkOpen(false)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [bulkOpen])

  const { data: groups = [] } = useQuery<LineGroup[]>({
    queryKey: ['transit', 'line-group', 'list'],
    queryFn:  async () => {
      const res = await apiFetch('/transit/line-group?pageSize=999')
      if (!res.ok) return []
      const json = await res.json()
      return json.data ?? []
    },
    staleTime: 60_000,
  })

  const q            = search.toLowerCase()
  const visibleLines = q
    ? planLines.filter(l => l.line.code.toLowerCase().includes(q) || l.line.name.toLowerCase().includes(q))
    : planLines

  const allChecked  = planLines.length > 0 && planLines.every(l => selectedLineIds.has(l.lineId))
  const someChecked = !allChecked && planLines.some(l => selectedLineIds.has(l.lineId))

  function toggleLine(lineId: string) {
    const next = new Set(selectedLineIds)
    if (next.has(lineId)) next.delete(lineId)
    else next.add(lineId)
    onSelectionChange(next)
  }

  function markAll() {
    onSelectionChange(new Set(planLines.map(l => l.lineId)))
    setBulkOpen(false)
  }

  function unmarkAll() {
    onSelectionChange(new Set())
    setBulkOpen(false)
    setGroupId('')
  }

  function applyGroup(gid: string) {
    setGroupId(gid)
    if (!gid) return
    const group = groups.find(g => g.id === gid)
    if (!group) return
    const groupSet = new Set(group.lineIds)
    const next = new Set(planLines.filter(l => groupSet.has(l.lineId)).map(l => l.lineId))
    onSelectionChange(next)
  }

  const checkboxIcon = allChecked
    ? <Icons.CheckSquare className="w-3.5 h-3.5 text-primary" />
    : someChecked
      ? <Icons.MinusSquare className="w-3.5 h-3.5 text-primary" />
      : <Icons.Square      className="w-3.5 h-3.5 text-muted-foreground" />

  return (
    <div className="w-64 shrink-0 border-l border-border flex flex-col bg-background">
      {/* header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <span className="text-sm font-medium">Linhas</span>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
        >
          <Icons.X className="w-4 h-4" />
        </button>
      </div>

      {/* search */}
      <div className="px-2 pt-2 pb-0 border-b border-border">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar linha…"
          className="w-full text-xs rounded-sm border border-input bg-input-bg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring mb-2"
        />

        {/* bulk select + group row */}
        <div className="flex items-center gap-1.5 pb-2">
          {/* checkbox with dropdown */}
          <div className="relative" ref={bulkRef}>
            <div className="flex items-center rounded border border-input bg-input-bg">
              <button
                type="button"
                onClick={() => allChecked ? unmarkAll() : markAll()}
                className="p-1 hover:bg-accent transition-colors rounded-l"
                title={allChecked ? 'Desmarcar todos' : 'Marcar todos'}
              >
                {checkboxIcon}
              </button>
              <button
                type="button"
                onClick={() => setBulkOpen(v => !v)}
                className="p-1 hover:bg-accent transition-colors border-l border-input rounded-r"
              >
                <Icons.ChevronDown className="w-3 h-3 text-muted-foreground" />
              </button>
            </div>
            {bulkOpen && (
              <div className="absolute top-full left-0 mt-0.5 w-36 bg-background border border-border rounded shadow-md z-10 text-xs">
                <button
                  type="button"
                  onClick={markAll}
                  className="w-full text-left px-3 py-1.5 hover:bg-accent transition-colors"
                >
                  Marcar todos
                </button>
                <button
                  type="button"
                  onClick={unmarkAll}
                  className="w-full text-left px-3 py-1.5 hover:bg-accent transition-colors"
                >
                  Desmarcar todos
                </button>
              </div>
            )}
          </div>

          {/* group select */}
          <div className="relative flex-1">
            <select
              value={groupId}
              onChange={e => applyGroup(e.target.value)}
              className="w-full appearance-none text-xs rounded-sm border border-input bg-input-bg px-2 py-1 pe-5 focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">Grupo de linhas</option>
              {groups.map(g => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
            <Icons.ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          </div>
        </div>
      </div>

      {/* line list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {planLines.length === 0 && (
          <p className="text-xs text-muted-foreground px-2 py-4 text-center">
            Nenhuma linha no plano
          </p>
        )}
        {visibleLines.length === 0 && planLines.length > 0 && (
          <p className="text-xs text-muted-foreground px-2 py-4 text-center">
            Nenhum resultado
          </p>
        )}
        {visibleLines.map(({ lineId, line }) => {
          const checked = selectedLineIds.has(lineId)
          return (
            <label
              key={lineId}
              className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent cursor-pointer select-none"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleLine(lineId)}
                className="w-3.5 h-3.5 accent-primary shrink-0"
              />
              <span className="text-xs font-mono font-medium">{line.code}</span>
              <span className="text-xs text-muted-foreground truncate flex-1">{line.name}</span>
            </label>
          )
        })}
      </div>

      {/* footer */}
      <div className="px-3 py-2 border-t border-border text-xs text-muted-foreground">
        {selectedLineIds.size} / {planLines.length} selecionada{planLines.length !== 1 ? 's' : ''}
      </div>
    </div>
  )
}
