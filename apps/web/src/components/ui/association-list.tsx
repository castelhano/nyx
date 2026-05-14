'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { Plus, X, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from './button'

const ROLES = [
  { value: 'member',  label: 'Membro',      title: 'Leitura e operações básicas' },
  { value: 'manager', label: 'Gerente',     title: 'Gerencia registros da filial' },
  { value: 'owner',   label: 'Responsável', title: 'Responsável pela filial' },
] as const

export interface BranchAssoc {
  branchId: string
  role:     string
}

interface Branch {
  id:         string
  name:       string
  companyId?: string
}

interface Company {
  id:   string
  name: string
}

interface Props {
  items:      BranchAssoc[]
  onChange:   (items: BranchAssoc[]) => void
  branches:   Branch[]
  companies?: Company[]
}

const inputBase = 'w-full border border-input rounded-sm px-3 py-2 text-sm bg-input-bg focus:outline-none focus:ring-1 focus:ring-ring'

function groupByCompany<T extends { companyId?: string }>(
  items:     T[],
  companies: Company[],
): { company: Company | null; items: T[] }[] {
  const map = new Map<string, T[]>()
  const rest: T[] = []

  for (const item of items) {
    const cid = item.companyId
    if (cid) {
      if (!map.has(cid)) map.set(cid, [])
      map.get(cid)!.push(item)
    } else {
      rest.push(item)
    }
  }

  const result: { company: Company | null; items: T[] }[] = []
  for (const [cid, groupItems] of map) {
    result.push({ company: companies.find((c) => c.id === cid) ?? null, items: groupItems })
  }
  if (rest.length > 0) result.push({ company: null, items: rest })
  return result
}

export function AssociationList({ items, onChange, branches, companies = [] }: Props) {
  const [search, setSearch] = useState('')
  const [open, setOpen]     = useState(false)
  const inputRef            = useRef<HTMLInputElement>(null)
  const containerRef        = useRef<HTMLDivElement>(null)

  const associatedIds = new Set(items.map((i) => i.branchId))

  const available = useMemo(
    () =>
      branches.filter(
        (b) =>
          !associatedIds.has(b.id) &&
          b.name.toLowerCase().includes(search.toLowerCase()),
      ),
    [branches, associatedIds, search],
  )

  // Available branches grouped by company (for the dropdown)
  const availableGroups = useMemo(
    () => (companies.length > 0 ? groupByCompany(available, companies) : null),
    [available, companies],
  )

  // Current items enriched with branch data, grouped by company
  const itemGroups = useMemo(() => {
    const enriched = items.map((item) => ({
      ...item,
      branch: branches.find((b) => b.id === item.branchId),
    }))

    if (companies.length === 0) return [{ company: null, items: enriched }]

    const byCompany = new Map<string, typeof enriched>()
    const rest: typeof enriched = []

    for (const item of enriched) {
      const cid = item.branch?.companyId
      if (cid) {
        if (!byCompany.has(cid)) byCompany.set(cid, [])
        byCompany.get(cid)!.push(item)
      } else {
        rest.push(item)
      }
    }

    const result: { company: Company | null; items: typeof enriched }[] = []
    for (const [cid, groupItems] of byCompany) {
      result.push({ company: companies.find((c) => c.id === cid) ?? null, items: groupItems })
    }
    if (rest.length > 0) result.push({ company: null, items: rest })
    return result
  }, [items, branches, companies])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    function handlePointerDown(e: PointerEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  function handleAdd(branch: Branch) {
    onChange([...items, { branchId: branch.id, role: 'member' }])
    setSearch('')
    setOpen(false)
  }

  function handleRemove(branchId: string) {
    onChange(items.filter((i) => i.branchId !== branchId))
  }

  function handleRoleChange(branchId: string, role: string) {
    onChange(items.map((i) => (i.branchId === branchId ? { ...i, role } : i)))
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {items.length === 0
            ? 'Nenhuma filial vinculada'
            : `${items.length} filial(is) vinculada(s)`}
        </span>

        <div ref={containerRef} className="relative">
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen((v) => !v)}>
            <Plus className="w-4 h-4" />
            Adicionar
          </Button>

          {open && (
            <div className="absolute right-0 top-full mt-1 z-20 w-72 rounded-md border border-border bg-popover shadow-lg p-2">
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar filial…"
                className={cn(inputBase, 'mb-2')}
              />
              <div className="max-h-56 overflow-y-auto space-y-0.5">
                {available.length === 0 ? (
                  <p className="px-2 py-1.5 text-sm text-muted-foreground">
                    {branches.length === items.length
                      ? 'Todas as filiais já vinculadas'
                      : 'Nenhuma filial encontrada'}
                  </p>
                ) : availableGroups ? (
                  availableGroups.map(({ company, items: gBranches }) => (
                    <div key={company?.id ?? '__none'}>
                      {company && (
                        <p className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                          {company.name}
                        </p>
                      )}
                      {gBranches.map((b) => (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => handleAdd(b)}
                          className="w-full text-left px-2 py-1.5 text-sm rounded-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                        >
                          {b.name}
                        </button>
                      ))}
                    </div>
                  ))
                ) : (
                  available.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => handleAdd(b)}
                      className="w-full text-left px-2 py-1.5 text-sm rounded-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                    >
                      {b.name}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {items.length > 0 && (
        <div className="border border-border rounded-sm overflow-hidden">
          {itemGroups.map(({ company, items: groupItems }, gi) => (
            <div key={company?.id ?? '__none'}>
              {company && (
                <div className={cn(
                  'px-3 py-1.5 text-xs font-medium text-muted-foreground bg-muted/40',
                  gi > 0 && 'border-t border-border',
                )}>
                  {company.name}
                </div>
              )}
              {groupItems.map((item, i) => (
                <div
                  key={item.branchId}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2',
                    (i > 0 || company) && 'border-t border-border',
                  )}
                >
                  <span className="flex-1 text-sm truncate">{item.branch?.name ?? item.branchId}</span>

                  <div className="relative flex-shrink-0">
                    <select
                      value={item.role}
                      onChange={(e) => handleRoleChange(item.branchId, e.target.value)}
                      title={ROLES.find((r) => r.value === item.role)?.title}
                      className="border border-input rounded-sm px-2 py-1 pr-7 text-sm bg-input-bg appearance-none focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      {ROLES.map((r) => (
                        <option key={r.value} value={r.value} title={r.title}>{r.label}</option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  </div>

                  <button
                    type="button"
                    onClick={() => handleRemove(item.branchId)}
                    title="Remover filial"
                    className="flex-shrink-0 p-1 rounded-sm text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
