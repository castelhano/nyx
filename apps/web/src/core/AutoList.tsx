'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useMetadata } from './useMetadata'
import { apiFetch } from '@/lib/auth'
import { ChevronDown, ChevronUp, ChevronsUpDown, Plus, SquarePen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useShortcut } from '@/lib/keywatch'
import type { MetadataField, PaginatedResult } from '@nyx/types'

interface Props {
  domain:   string
  resource: string
  onEdit?:  (id: string) => void
  onNew?:   () => void
}

function SortIcon({ active, order }: { active: boolean; order: 'asc' | 'desc' }) {
  if (!active)           return <ChevronsUpDown className="w-3 h-3 text-muted-foreground/50" />
  if (order === 'asc')   return <ChevronUp      className="w-3 h-3 text-ring" />
  return                        <ChevronDown    className="w-3 h-3 text-ring" />
}

export function AutoList({ domain, resource, onEdit, onNew }: Props) {
  const [page, setPage]           = useState(1)
  const [search, setSearch]       = useState('')
  const [sortField, setSortField] = useState<string | null>(null)
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')

  const { data: meta } = useMetadata(domain, resource)

  useShortcut('alt+n', () => onNew?.(), {
    desc:    'Novo registro',
    icon:    Plus,
    origin:  'apps/web/src/core/AutoList',
    enabled: !!onNew,
  })

  const { data, isLoading } = useQuery<PaginatedResult<Record<string, unknown>>>({
    queryKey: [domain, resource, page, search, sortField, sortOrder],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: '20',
        ...(search    ? { search }              : {}),
        ...(sortField ? { sortField, sortOrder } : {}),
      })
      const res = await apiFetch(`/${domain}/${resource}s?${params}`)
      if (!res.ok) throw new Error('Failed to fetch list')
      return res.json()
    },
    enabled: !!meta,
  })

  function handleSort(col: MetadataField) {
    if (!col.sortable) return
    if (sortField !== col.name) {
      setSortField(col.name)
      setSortOrder('asc')
    } else {
      setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'))
    }
    setPage(1)
  }

  if (!meta) return <div className="text-sm text-gray-500">Nenhum registro a exibir</div>

  const columns = meta.fields.filter((f) => f.showInList)

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input
          type="search"
          placeholder="Pesquisa"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          className="border rounded px-3 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {onNew && (
          <Button onClick={onNew} size="icon">
            <Plus className="w-4 h-4" />
          </Button>
        )}
      </div>
      {isLoading ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : (
        <div className='overflow-hidden rounded-sm border'>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted">
                {columns.map((col) => (
                  <th
                    key={col.name}
                    data-sort={sortField === col.name ? sortOrder : undefined}
                    data-sortable={col.sortable || undefined}
                    onClick={() => handleSort(col)}
                    className="text-left px-3 py-2 border-b font-medium
                               data-[sortable]:cursor-pointer data-[sortable]:select-none
                               data-[sortable]:hover:bg-accent/50
                               data-[sort]:bg-accent/60
                               data-[sort]:border-b-2 data-[sort]:border-b-ring
                               data-[sort]:text-ring"
                  >
                    <span className="flex items-center gap-1">
                      {col.label}
                      {col.sortable && (
                        <SortIcon active={sortField === col.name} order={sortOrder} />
                      )}
                    </span>
                  </th>
                ))}
                {onEdit && <th className="px-3 py-2 border-b" />}
              </tr>
            </thead>
            <tbody>
              {data?.data.map((row) => (
                <tr key={String(row.id)} className="hover:bg-row-hover border-b">
                  {columns.map((col) => (
                    <td key={col.name} className="px-3 py-2">
                      {String(row[col.name] ?? '')}
                    </td>
                  ))}
                  {onEdit && (
                    <td className="px-3 py-1 text-end">
                      <Button
                        onClick={() => onEdit(String(row.id))}
                        size='icon'
                        variant='rowAction'>
                        <SquarePen className='w-4 h-4' />
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center gap-2 text-sm text-muted">
        <button
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page === 1}
          className="px-3 py-1 border rounded disabled:opacity-40 hover:bg-accent"
        >
          Prev
        </button>
        <span>{data?.total ?? 0} records — page {page}</span>
        <button
          onClick={() => setPage((p) => p + 1)}
          disabled={!data || page * 20 >= data.total}
          className="px-3 py-1 border rounded disabled:opacity-40 hover:bg-accent"
        >
          Next
        </button>
      </div>
    </div>
  )
}
