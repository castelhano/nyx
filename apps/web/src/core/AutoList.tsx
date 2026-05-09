'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useMetadata } from './useMetadata'
import { apiFetch } from '@/lib/auth'
import { SquarePen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { PaginatedResult } from '@nyx/types'

interface Props {
  domain:   string
  resource: string
  onEdit?:  (id: string) => void
}

export function AutoList({ domain, resource, onEdit }: Props) {
  const [page, setPage]     = useState(1)
  const [search, setSearch] = useState('')

  const { data: meta } = useMetadata(domain, resource)

  const { data, isLoading } = useQuery<PaginatedResult<Record<string, unknown>>>({
    queryKey: [domain, resource, page, search],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: '20', ...(search ? { search } : {}) })
      const res = await apiFetch(`/${domain}/${resource}s?${params}`)
      if (!res.ok) throw new Error('Failed to fetch list')
      return res.json()
    },
    enabled: !!meta,
  })

  if (!meta) return <div className="text-sm text-gray-500">Nenhum registro a exibir</div>

  const columns = meta.fields.filter((f) => f.showInList)

  return (
    <div className="space-y-3">
      <input
        type="search"
        placeholder="Pesquisa"
        value={search}
        onChange={(e) => { setSearch(e.target.value); setPage(1) }}
        className="border rounded px-3 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      {isLoading ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : (
        <div className='overflow-hidden rounded-sm border'>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted">
                {columns.map((col) => (
                  <th key={col.name} className="text-left px-3 py-2 border-b font-medium">
                    {col.label}
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
