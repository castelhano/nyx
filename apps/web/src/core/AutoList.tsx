'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table'
import { useMetadata } from './useMetadata'
import { apiFetch } from '@/lib/auth'
import { ChevronDown, ChevronUp, ChevronsUpDown, Columns3, SquarePen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { MetadataField, PaginatedResult } from '@nyx/types'

type Row = Record<string, unknown>

interface Props {
  domain:   string
  resource: string
  onEdit?:  (id: string) => void
}

function SortIcon({ state }: { state: false | 'asc' | 'desc' }) {
  if (!state)          return <ChevronsUpDown className="w-3 h-3 text-muted-foreground/50" />
  if (state === 'asc') return <ChevronUp      className="w-3 h-3 text-ring" />
  return                      <ChevronDown    className="w-3 h-3 text-ring" />
}

function buildColumns(
  fields: MetadataField[],
  sorting: SortingState,
  onSort: (field: MetadataField) => void,
  onEdit?: (id: string) => void,
): ColumnDef<Row>[] {
  const cols: ColumnDef<Row>[] = fields
    .filter((f) => f.listVisibility !== 'never')
    .map((col) => ({
      id:          col.name,
      accessorKey: col.name,
      enableHiding: true,
      enableSorting: col.sortable,
      header: () => {
        const sorted = sorting[0]?.id === col.name
          ? (sorting[0].desc ? 'desc' : 'asc')
          : false
        return (
          <span
            onClick={() => col.sortable && onSort(col)}
            className={cn(
              'flex items-center gap-1',
              col.sortable && 'cursor-pointer select-none',
            )}
          >
            {col.label}
            {col.sortable && <SortIcon state={sorted} />}
          </span>
        )
      },
      cell: ({ getValue }) => {
        const val = getValue()
        if (val === null || val === undefined) return ''
        if (typeof val === 'boolean') return val ? 'Sim' : 'Não'
        return String(val)
      },
    }))

  if (onEdit) {
    cols.push({
      id:           '_actions',
      enableHiding: false,
      header:       () => null,
      cell:         ({ row }) => (
        <Button
          onClick={() => onEdit(String(row.original.id))}
          size="icon"
          variant="rowAction"
        >
          <SquarePen className="w-4 h-4" />
        </Button>
      ),
    })
  }

  return cols
}

export function AutoList({ domain, resource, onEdit }: Props) {
  const [page,      setPage]      = useState(1)
  const [search,    setSearch]    = useState('')
  const [sorting,   setSorting]   = useState<SortingState>([])
  const [visibility, setVisibility] = useState<VisibilityState>({})
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  const { data: meta } = useMetadata(domain, resource)

  const sortField = sorting[0]?.id     ?? null
  const sortOrder = sorting[0]?.desc   ? 'desc' : 'asc'

  const { data, isLoading } = useQuery<PaginatedResult<Row>>({
    queryKey: [domain, resource, page, search, sortField, sortOrder],
    queryFn:  async () => {
      const params = new URLSearchParams({
        page:     String(page),
        pageSize: '20',
        ...(search    ? { search }              : {}),
        ...(sortField ? { sortField, sortOrder } : {}),
      })
      const res = await apiFetch(`/${domain}/${resource}?${params}`)
      if (!res.ok) throw new Error('Failed to fetch list')
      return res.json()
    },
    enabled: !!meta,
  })

  // Initialize column visibility from listVisibility
  useEffect(() => {
    if (!meta) return
    const initial: VisibilityState = {}
    for (const f of meta.fields) {
      if (f.listVisibility === 'hidden') initial[f.name] = false
    }
    setVisibility(initial)
  }, [meta?.resource])

  // Close picker on outside click
  useEffect(() => {
    if (!pickerOpen) return
    function onOutside(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [pickerOpen])

  function handleSort(col: MetadataField) {
    setSorting((prev) => {
      if (prev[0]?.id !== col.name) return [{ id: col.name, desc: false }]
      if (!prev[0].desc)            return [{ id: col.name, desc: true }]
      return []
    })
    setPage(1)
  }

  const columns = useMemo(
    () => buildColumns(meta?.fields ?? [], sorting, handleSort, onEdit),
    [meta?.fields, sorting, onEdit],
  )

  const table = useReactTable({
    data:                    data?.data ?? [],
    columns,
    state:                   { columnVisibility: visibility },
    onColumnVisibilityChange: setVisibility,
    getCoreRowModel:         getCoreRowModel(),
    manualSorting:           true,
    manualPagination:        true,
  })

  const toggleableFields = meta?.fields.filter((f) => f.listVisibility !== 'never') ?? []

  if (!meta) return <div className="text-sm text-muted-foreground">Carregando…</div>

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <input
          type="search"
          placeholder="Pesquisar…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          className="border border-input rounded px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-1 focus:ring-ring"
        />

        <div className="relative ml-auto" ref={pickerRef}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPickerOpen((o) => !o)}
          >
            <Columns3 className="w-3.5 h-3.5" />
            Colunas
          </Button>

          {pickerOpen && (
            <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border rounded-[--radius] shadow-md p-1 min-w-44">
              {toggleableFields.map((f) => (
                <label
                  key={f.name}
                  className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-accent hover:text-accent-foreground rounded-sm select-none"
                >
                  <input
                    type="checkbox"
                    checked={table.getColumn(f.name)?.getIsVisible() ?? true}
                    onChange={(e) => table.getColumn(f.name)?.toggleVisibility(e.target.checked)}
                  />
                  {f.label}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-sm text-muted-foreground">Carregando…</div>
      ) : (
        <div className="overflow-hidden rounded-sm border border-border">
          <table className="w-full text-sm">
            <thead>
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id} className="bg-muted">
                  {hg.headers.map((header) => {
                    const sorted = sorting[0]?.id === header.id
                    return (
                      <th
                        key={header.id}
                        className={cn(
                          'text-left px-3 py-2 border-b font-medium',
                          header.column.getCanSort() && 'cursor-pointer select-none hover:bg-accent/50',
                          sorted && 'bg-accent/60 border-b-2 border-b-ring text-ring',
                        )}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </th>
                    )
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="hover:bg-accent/20 border-b border-border">
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className={cn(
                        'px-3 py-2',
                        cell.column.id === '_actions' && 'text-end px-1 py-1',
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page === 1}
          className="px-3 py-1 border border-border rounded-sm disabled:opacity-40 hover:bg-accent hover:text-accent-foreground"
        >
          Anterior
        </button>
        <span>{data?.total ?? 0} registros — página {page}</span>
        <button
          onClick={() => setPage((p) => p + 1)}
          disabled={!data || page * 20 >= data.total}
          className="px-3 py-1 border border-border rounded-sm disabled:opacity-40 hover:bg-accent hover:text-accent-foreground"
        >
          Próxima
        </button>
      </div>
    </div>
  )
}
