'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
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
import { useToast } from '@/lib/toast-context'
import { msgs } from '@/lib/messages'
import { ChevronDown, ChevronUp, ChevronsUpDown, Columns3, SquarePen, Layers, BetweenVerticalStart, ArrowRightFromLine, ArrowLeftFromLine, X, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { FilterDef, MetadataField, PaginatedResult, RowActionDef } from '@nyx/types'
import { RowActionsCell } from './RowActionsCell'

type Row = Record<string, unknown>

function resolveTemplate(template: string, row: Row): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(row[key] ?? ''))
}

interface Props {
  domain:    string
  resource:  string
  onEdit?:   (id: string) => void
  onAction?: (action: string, row: Row) => void | Promise<void>
  filters?:  Record<string, string>
}

// ---------------------------------------------------------------------------
// FilterBar
// ---------------------------------------------------------------------------

function RelationFilter({
  field,
  filterDef,
  value,
  parentValue,
  onChange,
  wrapperClassName,
}: {
  field:             MetadataField
  filterDef:         Extract<FilterDef, { type: 'relation' }>
  value:             string
  parentValue:       string | undefined
  onChange:          (v: string) => void
  wrapperClassName?: string
}) {
  const { data: options = [] } = useQuery<{ id: string; [k: string]: unknown }[]>({
    queryKey: ['filter-options', filterDef.endpoint, parentValue],
    queryFn: async () => {
      const params = new URLSearchParams({ pageSize: '999' })
      if (filterDef.dependsOn && parentValue) params.set(filterDef.dependsOn, parentValue)
      const res = await apiFetch(`/${filterDef.endpoint}?${params}`)
      if (!res.ok) return []
      const json = await res.json()
      return json.data ?? []
    },
    staleTime: 60_000,
  })

  useEffect(() => { onChange('') }, [parentValue])

  return (
    <Select size="sm" value={value} onChange={(e) => onChange(e.target.value)} wrapperClassName={wrapperClassName}>
      <option value="">{field.label}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>{String(o[filterDef.labelField] ?? o.id)}</option>
      ))}
    </Select>
  )
}

function FilterBar({
  fields,
  values,
  onChange,
  onClear,
  layout = 'inline',
  className,
}: {
  fields:     MetadataField[]
  values:     Record<string, string>
  onChange:   (key: string, value: string) => void
  onClear:    () => void
  layout?:    'inline' | 'stacked'
  className?: string
}) {
  const filterable = fields.filter((f) => f.filter)
  if (!filterable.length) return null

  const stacked = layout === 'stacked'

  const hasActive = filterable.some((f) => {
    const key = `f_${f.name}`
    return values[key] || values[`${key}_min`] || values[`${key}_max`] || values[`${key}_from`] || values[`${key}_to`]
  })

  return (
    <div className={className}>
      {filterable.map((field) => {
        const key    = `f_${field.name}`
        const filter = field.filter!

        if (filter.type === 'select') {
          return (
            <Select key={field.name} size="sm" value={values[key] ?? ''} onChange={(e) => onChange(key, e.target.value)} wrapperClassName={stacked ? 'w-full' : undefined}>
              <option value="">{field.label}</option>
              {(field.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
            </Select>
          )
        }

        if (filter.type === 'boolean') {
          return (
            <Select key={field.name} size="sm" value={values[key] ?? ''} onChange={(e) => onChange(key, e.target.value)} wrapperClassName={stacked ? 'w-full' : undefined}>
              <option value="">{field.label}</option>
              <option value="true">Sim</option>
              <option value="false">Não</option>
            </Select>
          )
        }

        if (filter.type === 'text') {
          return (
            <Input key={field.name} size="sm" type="text" placeholder={field.label} value={values[key] ?? ''} onChange={(e) => onChange(key, e.target.value)} className={stacked ? 'w-full' : 'min-w-32'} />
          )
        }

        if (filter.type === 'number_range') {
          return (
            <span key={field.name} className={cn('flex items-center gap-1', stacked && 'w-full')}>
              <Input size="sm" type="number" placeholder={`${field.label} mín`} value={values[`${key}_min`] ?? ''} onChange={(e) => onChange(`${key}_min`, e.target.value)} className={stacked ? 'flex-1' : 'w-28'} />
              <span className="text-muted-foreground text-xs">–</span>
              <Input size="sm" type="number" placeholder={`${field.label} máx`} value={values[`${key}_max`] ?? ''} onChange={(e) => onChange(`${key}_max`, e.target.value)} className={stacked ? 'flex-1' : 'w-28'} />
            </span>
          )
        }

        if (filter.type === 'date_range') {
          return (
            <span key={field.name} className={cn('flex items-center gap-1', stacked && 'w-full')}>
              <Input size="sm" type="date" title={`${field.label} de`} value={values[`${key}_from`] ?? ''} onChange={(e) => onChange(`${key}_from`, e.target.value)} className={stacked ? 'flex-1' : undefined} />
              <span className="text-muted-foreground text-xs">–</span>
              <Input size="sm" type="date" title={`${field.label} até`} value={values[`${key}_to`] ?? ''} onChange={(e) => onChange(`${key}_to`, e.target.value)} className={stacked ? 'flex-1' : undefined} />
            </span>
          )
        }

        if (filter.type === 'relation') {
          const parentKey   = filter.dependsOn ? `f_${filter.dependsOn}` : undefined
          const parentValue = parentKey ? (values[parentKey] ?? undefined) : undefined
          return (
            <RelationFilter key={field.name} field={field} filterDef={filter} value={values[key] ?? ''} parentValue={parentValue} onChange={(v) => onChange(key, v)} wrapperClassName={stacked ? 'w-full' : undefined} />
          )
        }

        return null
      })}

      {hasActive && (
        <Button type="button" variant="outline" size="sm" onClick={onClear} className={cn('text-muted-foreground', stacked && 'mt-1 w-full')}>
          <X className="w-3.5 h-3.5" />
          {stacked && 'Limpar'}
        </Button>
      )}
    </div>
  )
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
  rowActions?: RowActionDef[],
  onRowAction?: (action: RowActionDef, row: Row) => void,
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
      cell: ({ getValue, row: tableRow }) => {
        if (col.widget === 'select' && col.labelField) {
          const relationName = col.name.replace(/Id$/, '')
          const related = (tableRow.original as any)[relationName]
          if (related && col.labelField in related) return String(related[col.labelField])
        }
        const val = getValue()
        if (val === null || val === undefined) return ''
        if (typeof val === 'boolean') return val ? 'Sim' : 'Não'
        return String(val)
      },
    }))

  if (rowActions?.length && onRowAction) {
    cols.push({
      id:           '_rowActions',
      enableHiding: false,
      header:       () => null,
      cell:         ({ row }) => (
        <RowActionsCell
          row={row.original}
          actions={rowActions}
          onExecute={onRowAction}
        />
      ),
    })
  }

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

export function AutoList({ domain, resource, onEdit, onAction, filters }: Props) {
  const router      = useRouter()
  const queryClient = useQueryClient()
  const { toast }   = useToast()

  const [page,          setPage]          = useState(1)
  const [sorting,       setSorting]       = useState<SortingState>([])
  const [visibility,    setVisibility]    = useState<VisibilityState>({})
  const [pickerOpen,    setPickerOpen]    = useState(false)
  const [filterOpen,    setFilterOpen]    = useState(false)
  const [focusedRow,    setFocusedRow]    = useState<number | null>(null)
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({})
  const pickerRef = useRef<HTMLDivElement>(null)
  const filterRef = useRef<HTMLDivElement>(null)

  function handleFilterChange(key: string, value: string) {
    setActiveFilters((prev) => ({ ...prev, [key]: value }))
    setPage(1)
  }

  function handleFilterClear() {
    setActiveFilters({})
    setPage(1)
  }

  const { data: meta } = useMetadata(domain, resource)

  const visibleRowActions = useMemo(
    () => (meta?.rowActions ?? []).filter((a) => meta!.permissions[a.permission]),
    [meta?.rowActions, meta?.permissions],
  )

  const handleRowAction = useCallback(async (action: RowActionDef, row: Row) => {
    if (action.hrefTemplate) {
      router.push(resolveTemplate(action.hrefTemplate, row))
      return
    }
    if (action.method && action.endpointTemplate) {
      try {
        const res = await apiFetch(resolveTemplate(action.endpointTemplate, row), {
          method: action.method,
          body:   JSON.stringify(action.body ?? {}),
        })
        if (!res.ok) throw new Error('Failed')
        queryClient.invalidateQueries({ queryKey: [domain, resource] })
        const successMsg = action.method === 'DELETE' ? msgs.deleted() : msgs.updated()
        toast.success(successMsg)
      } catch {
        const errorMsg = action.method === 'DELETE' ? msgs.error.delete() : msgs.error.save()
        toast.error(errorMsg)
      }
      return
    }
    onAction?.(action.action, row)
  }, [domain, resource, onAction, router, queryClient, toast])

  const sortField = sorting[0]?.id   ?? null
  const sortOrder = sorting[0]?.desc ? 'desc' : 'asc'

  const { data, isLoading } = useQuery<PaginatedResult<Row>>({
    queryKey: [domain, resource, page, sortField, sortOrder, filters, activeFilters],
    queryFn:  async () => {
      const params = new URLSearchParams({
        page:     String(page),
        pageSize: '20',
        ...(sortField ? { sortField, sortOrder } : {}),
        ...(filters   ? filters                  : {}),
        ...activeFilters,
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

  useEffect(() => { setFocusedRow(null) }, [page, sorting, filters, activeFilters])

  useEffect(() => {
    if (!pickerOpen) return
    function onOutside(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [pickerOpen])

  useEffect(() => {
    if (!filterOpen) return
    function onOutside(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [filterOpen])

  useShortcut('alt+l', () => {
    if (Object.values(activeFilters).some(Boolean)) handleFilterClear()
  }, { display: false, origin: 'apps.web.src.core.AutoList' })

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

  const handleSort = useCallback((col: MetadataField) => {
    setSorting((prev) => {
      if (prev[0]?.id !== col.name) return [{ id: col.name, desc: false }]
      if (!prev[0].desc)            return [{ id: col.name, desc: true }]
      return []
    })
    setPage(1)
  }, [])

  const columns = useMemo(
    () => buildColumns(meta?.fields ?? [], sorting, handleSort, meta?.permissions?.update !== false ? onEdit : undefined, visibleRowActions, handleRowAction),
    [meta?.fields, sorting, handleSort, meta?.permissions?.update, onEdit, visibleRowActions, handleRowAction],
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
  const filterableFields = meta?.fields.filter((f) => f.filter) ?? []
  const activeCount      = filterableFields.filter((f) => {
    const key = `f_${f.name}`
    return activeFilters[key] || activeFilters[`${key}_min`] || activeFilters[`${key}_max`] || activeFilters[`${key}_from`] || activeFilters[`${key}_to`]
  }).length

  if (!meta) return <div className="text-sm text-muted-foreground">Carregando…</div>

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-2">

        {/* Desktop: filtros inline */}
        <FilterBar
          fields={meta.fields}
          values={activeFilters}
          onChange={handleFilterChange}
          onClear={handleFilterClear}
          layout="inline"
          className="hidden md:flex flex-wrap items-center gap-2 flex-1"
        />

        {/* Mobile: botão Filtros + dropdown */}
        {filterableFields.length > 0 && (
          <div className="relative md:hidden" ref={filterRef}>
            <Button variant="outline" size="sm" onClick={() => setFilterOpen((o) => !o)} className="relative">
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Filtros</span>
              {activeCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-0.5 rounded-full bg-ring text-[10px] text-white flex items-center justify-center">
                  {activeCount}
                </span>
              )}
            </Button>
            {filterOpen && (
              <div className="absolute left-0 top-full mt-1 z-50 bg-card border border-border rounded-[--radius] shadow-md p-3 min-w-56">
                <FilterBar
                  fields={meta.fields}
                  values={activeFilters}
                  onChange={handleFilterChange}
                  onClear={handleFilterClear}
                  layout="stacked"
                  className="flex flex-col gap-2"
                />
              </div>
            )}
          </div>
        )}

        {/* Colunas */}
        <div className="relative ml-auto" ref={pickerRef}>
          <Button variant="outline" size="sm" onClick={() => setPickerOpen((o) => !o)}>
            <Columns3 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Colunas</span>
          </Button>
          {pickerOpen && (
            <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border rounded-[--radius] shadow-md p-1 min-w-44">
              {toggleableFields.map((f) => (
                <label key={f.name} className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-accent hover:text-accent-foreground rounded-sm select-none">
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
        <div className="w-full overflow-x-auto rounded-sm border border-border bg-card/50">
          <table className="w-full min-w-max text-sm">
            <thead>
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id} className="bg-accent/15">
                  {hg.headers.map((header) => {
                    const sorted = sorting[0]?.id === header.id
                    return (
                      <th
                        key={header.id}
                        className={cn(
                          'text-left px-3 py-2 border-b font-medium',
                          header.column.getCanSort() && 'cursor-pointer select-none hover:bg-accent/10',
                          sorted && 'bg-accent/20 border-b-2 border-b-ring text-ring',
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
                    'hover:bg-row-hover border-b border-border cursor-default',
                    rowIdx === focusedRow && 'bg-ring/10 shadow-[inset_2px_0_0_hsl(var(--ring)_/_0.5),inset_-2px_0_0_hsl(var(--ring)_/_0.5)]',
                  )}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className={cn(
                        'px-3 py-2',
                        (cell.column.id === '_actions' || cell.column.id === '_rowActions') && 'text-end px-1 py-1',
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
