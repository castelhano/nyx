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
import { useShortcut } from '@/lib/keywatch'
import { apiFetch } from '@/lib/auth'
import { ChevronDown, ChevronUp, ChevronsUpDown, Columns3, SquarePen, Layers, BetweenVerticalStart, ArrowRightFromLine, ArrowLeftFromLine } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { MetadataField, PaginatedResult } from '@nyx/types'

type Row = Record<string, unknown>

interface Props {
  domain:    string
  resource:  string
  onEdit?:   (id: string) => void
  filters?:  Record<string, string>
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

export function AutoList({ domain, resource, onEdit, filters }: Props) {
  const [page,       setPage]       = useState(1)
  const [search,     setSearch]     = useState('')
  const [sorting,    setSorting]    = useState<SortingState>([])
  const [visibility, setVisibility] = useState<VisibilityState>({})
  const [pickerOpen, setPickerOpen] = useState(false)
  const [focusedRow, setFocusedRow] = useState<number | null>(null)
  const pickerRef = useRef<HTMLDivElement>(null)

  const { data: meta } = useMetadata(domain, resource)

  const sortField = sorting[0]?.id   ?? null
  const sortOrder = sorting[0]?.desc ? 'desc' : 'asc'

  const { data, isLoading } = useQuery<PaginatedResult<Row>>({
    queryKey: [domain, resource, page, search, sortField, sortOrder, filters],
    queryFn:  async () => {
      const params = new URLSearchParams({
        page:     String(page),
        pageSize: '20',
        ...(search    ? { search }              : {}),
        ...(sortField ? { sortField, sortOrder } : {}),
        ...(filters   ? filters                  : {}),
      })
      const res = await apiFetch(`/${domain}/${resource}?${params}`)
      if (!res.ok) throw new Error('Failed to fetch list')
      return res.json()
    },
    enabled: !!meta,
  })

  useEffect(() => {
    if (!meta) return
    const initial: VisibilityState = {}
    for (const f of meta.fields) {
      if (f.listVisibility === 'hidden') initial[f.name] = false
    }
    setVisibility(initial)
  }, [meta?.resource])

  useEffect(() => { setFocusedRow(null) }, [page, search, sorting, filters])

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

  useShortcut('ctrl+arrowdown', () => {
    const rows = table.getRowModel().rows
    
    if (!rows.length) return
    setFocusedRow((prev) => prev === null ? 0 : Math.min(prev + 1, rows.length - 1))
  }, { desc: 'Tabela - Linha seguinte', icon: ChevronDown, origin: 'apps.web.src.core.AutoList' })

  useShortcut('ctrl+arrowup', () => {
    const rows = table.getRowModel().rows
    if (!rows.length) return
    setFocusedRow((prev) => prev === null ? rows.length - 1 : Math.max(prev - 1, 0))
  }, { desc: 'Tabela - Linha anterior', icon: ChevronUp, origin: 'apps.web.src.core.AutoList' })

  useShortcut('alt+pagedown', () => {
    if (data && page * 20 < data.total) setPage((p) => p + 1)
  }, { desc: 'Tabela - Próxima página', icon: ArrowRightFromLine, origin: 'apps.web.src.core.AutoList' })

  useShortcut('alt+pageup', () => {
    if (page > 1) setPage((p) => Math.max(1, p - 1))
  }, { desc: 'Tabela - Página anterior', icon: ArrowLeftFromLine, origin: 'apps.web.src.core.AutoList' })

  useShortcut('ctrl+enter', () => {
    const rows = table.getRowModel().rows
    if (focusedRow !== null && onEdit && rows[focusedRow]) {
      onEdit(String(rows[focusedRow].original.id))
    }
  }, { desc: 'Tabela - Editar linha selecionada', icon: SquarePen, origin: 'apps.web.src.core.AutoList' })

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
    <div>
      {/* Toolbar */}
      <div className="flex items-center gap-x-2 mb-2">
        <input
          type="search"
          placeholder="Pesquisar…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          className="border border-input rounded px-3 py-1.5 text-sm w-full max-w-[600px] focus:outline-none focus:ring-1 focus:ring-ring"
        />

        <div className="relative ml-auto" ref={pickerRef}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPickerOpen((o) => !o)}
          >
            <Columns3 className="w-3.5 h-3.5" />
            <span className='hidden sm:inline'>Colunas</span>
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
        <div className="w-full overflow-x-auto rounded-sm border border-border">
          <table className="w-full min-w-max text-sm">
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
              {table.getRowModel().rows.map((row, rowIdx) => (
                <tr
                  key={row.id}
                  onClick={() => setFocusedRow(rowIdx)}
                  className={cn(
                    'hover:bg-accent/20 border-b border-border cursor-default',
                    rowIdx === focusedRow && 'bg-ring/10 shadow-[inset_2px_0_0_hsl(var(--ring)_/_0.5),inset_-2px_0_0_hsl(var(--ring)_/_0.5)]',
                  )}
                >
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
      <div className="flex items-center justify-between ps-1 pt-1 text-sm text-muted-foreground">
        <div className='flex items-center gap-x-2'>
          <Layers className='w-4 h-4' />
          <span>{data?.total}</span>
        </div>
        <div className='flex items-center'>
          <div className='flex items-center gap-x-2 me-3'>
            <BetweenVerticalStart className='w-4 h-4' />
            <span>
              {data && data.total > 0 ? (
                <>{data.page} . {Math.ceil(data.total / data.pageSize)}</>
              ) : ''}
            </span>
          </div>
          <Button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            size="icon"
            variant="ghost"
          >
            <ArrowLeftFromLine className='w-4 h-4' />
          </Button>
          <Button
            onClick={() => setPage((p) => p + 1)}
            disabled={!data || page * 20 >= data.total}
            size="icon"
            variant="ghost"
          >
            <ArrowRightFromLine className='w-4 h-4' />
          </Button>
        </div>
      </div>
    </div>
  )
}
