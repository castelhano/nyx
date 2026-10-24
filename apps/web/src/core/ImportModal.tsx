'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Icons } from '@/lib/icons'
import { cn, extractError } from '@/lib/utils'
import { apiFetch, uploadFile } from '@/lib/auth'
import { downloadCsvRows } from '@/lib/csv'
import { useToast } from '@/lib/toast-context'
import { useShortcut, useShortcutContext } from '@/lib/keywatch'
import { Button } from '@/components/ui/button'
import type { ImportColumn, ImportResult, ImportRow } from '@nyx/types'
import { useMetadata } from './useMetadata'

// Standard CSV import (docs/FLOW.md): the file is sent as a dry run on load, the preview shows
// what would happen, and Gravar sends it again for real — nothing is written while any row is
// invalid. The preview has a fixed height and pages, so hundreds of rows never grow the modal.

const PAGE_SIZE = 100

type Filter = 'all' | 'valid' | 'invalid'

interface Props {
  domain:   string
  resource: string
  onClose:  () => void
}

const TYPE_HINT: Record<ImportColumn['type'], string> = {
  string:   'texto',
  number:   'número (vírgula decimal)',
  boolean:  'SIM / NAO',
  date:     'dd/mm/aaaa',
  time:     'H:MM',
  enum:     'lista',
  relation: 'referência',
  list:     'vários, separados por |',
}

function columnHint(c: ImportColumn): string {
  if (c.type === 'enum') return c.options?.join(' · ') ?? ''
  if (c.type === 'relation') return `${c.label} (${c.ref})`
  if (c.type === 'list') return `${c.item === 'enum' ? c.options?.join(' · ') : c.item === 'relation' ? `${c.label} (${c.ref})` : c.label} — ${TYPE_HINT.list}`
  return TYPE_HINT[c.type]
}

export function ImportModal({ domain, resource, onClose }: Props) {
  useShortcutContext('import_md')
  const { toast }   = useToast()
  const queryClient = useQueryClient()
  const fileRef     = useRef<HTMLInputElement>(null)
  const { data: meta } = useMetadata(domain, resource)
  const columns     = meta?.import?.columns ?? []
  // the record's own columns, then each importNested group (e.g. the employee's contract)
  const columnGroups = useMemo(() => {
    const groups: { key: string; label?: string; columns: ImportColumn[] }[] = []
    for (const c of meta?.import?.columns ?? []) {
      const key = c.group ?? ''
      let g = groups.find(x => x.key === key)
      if (!g) groups.push(g = { key, label: c.groupLabel, columns: [] })
      g.columns.push(c)
    }
    return groups
  }, [meta])

  const [file,       setFile]       = useState<File | null>(null)
  const [result,     setResult]     = useState<ImportResult | null>(null)
  const [busy,       setBusy]       = useState<'check' | 'save' | null>(null)
  const [failure,    setFailure]    = useState<string | null>(null)
  const [filter,     setFilter]     = useState<Filter>('all')
  const [page,       setPage]       = useState(0)
  const [showFields, setShowFields] = useState(false)
  const [valuesOf,   setValuesOf]   = useState<string | null>(null)
  const [valueQuery, setValueQuery] = useState('')
  const [dragging,   setDragging]   = useState(false)

  const valuesColumn = columns.find(c => c.name === valuesOf)
  const valueGroups  = useMemo(() => {
    const q = valueQuery.trim().toLowerCase()
    const groups: { group: string; values: NonNullable<ImportColumn['values']> }[] = []
    for (const v of valuesColumn?.values ?? []) {
      if (q && !`${v.value} ${v.label} ${v.group ?? ''}`.toLowerCase().includes(q)) continue
      let g = groups.find(x => x.group === (v.group ?? ''))
      if (!g) groups.push(g = { group: v.group ?? '', values: [] })
      g.values.push(v)
    }
    return groups
  }, [valuesColumn, valueQuery])

  const canSave = !!result && !busy && !result.errors.length && !result.invalid && result.total > 0

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  useShortcut('alt+g', () => { if (canSave) save() }, {
    desc:    'Gravar importação',
    context: 'import_md',
    icon:    Icons.Save,
    origin:  'apps/web/src/core/ImportModal.tsx',
  })

  async function send(f: File, dryRun: boolean): Promise<ImportResult | null> {
    const form = new FormData()
    form.append('file', f)
    const res  = await uploadFile(`/${domain}/${resource}/import?dryRun=${dryRun}`, form)
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      setFailure(extractError(json, 'Erro ao processar o arquivo'))
      return null
    }
    return json as ImportResult
  }

  async function check(f: File) {
    setFile(f)
    setResult(null)
    setFailure(null)
    setFilter('all')
    setPage(0)
    setBusy('check')
    try {
      setResult(await send(f, true))
    } finally {
      setBusy(null)
    }
  }

  async function save() {
    if (!file) return
    setBusy('save')
    try {
      const res = await send(file, false)
      if (!res) return
      // the data may have changed since the preview — then the fresh result is shown instead
      if (res.errors.length || res.invalid) {
        setResult(res)
        setFilter('invalid')
        setPage(0)
        toast.error('Os dados mudaram desde a prévia — revise os erros')
        return
      }
      const parts = [
        res.created && `${res.created} criado${res.created !== 1 ? 's' : ''}`,
        res.updated && `${res.updated} atualizado${res.updated !== 1 ? 's' : ''}`,
      ].filter(Boolean)
      toast.success(`Importação concluída: ${parts.join(', ')}`)
      queryClient.invalidateQueries({ queryKey: [domain, resource] })
      onClose()
    } finally {
      setBusy(null)
    }
  }

  async function downloadTemplate() {
    const res = await apiFetch(`/${domain}/${resource}/import/template`)
    if (!res.ok) {
      toast.error(extractError(await res.json().catch(() => ({})), 'Erro ao gerar o modelo'))
      return
    }
    const { headers, rows } = await res.json() as { headers: string[]; rows: string[][] }
    downloadCsvRows(headers, rows, `modelo-${resource}`)
  }

  function copy(text: string, what: string) {
    navigator.clipboard.writeText(text).then(() => toast.success(`${what} copiado`))
  }

  const counts = useMemo(() => {
    const invalid = result?.invalid ?? 0
    return { all: result?.total ?? 0, valid: (result?.total ?? 0) - invalid, invalid }
  }, [result])

  const filtered = useMemo<ImportRow[]>(() => {
    const rows = result?.rows ?? []
    if (filter === 'valid')   return rows.filter(r => !r.errors.length)
    if (filter === 'invalid') return rows.filter(r => r.errors.length)
    return rows
  }, [result, filter])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageRows  = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  function pickFile(f: File | undefined) {
    if (f) check(f)
    if (fileRef.current) fileRef.current.value = ''
  }

  const modal = (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-12"
      onPointerDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}
    >
      <div className="absolute inset-0 bg-black/50 pointer-events-none" />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-5xl bg-background border border-border rounded-lg shadow-xl flex flex-col max-h-[88vh]"
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false) }}
        onDrop={(e) => { e.preventDefault(); setDragging(false); pickFile(e.dataTransfer.files?.[0]) }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="font-semibold text-base">Importar {meta?.labelPlural ?? ''}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              CSV separado por <code className="font-mono">;</code> · datas dd/mm/aaaa · decimais com vírgula · SIM / NAO.
              Célula vazia mantém o valor atual.
            </p>
            {meta?.import?.notice && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                <Icons.AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
                {meta.import.notice}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} disabled={!!busy} className="text-muted-foreground hover:text-foreground transition-colors">
            <Icons.X className="w-4 h-4" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-border shrink-0">
          {file ? (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={!!busy}
              className="flex items-center gap-2 min-w-0 max-w-sm px-3 h-8 rounded-sm border border-border bg-muted/40 text-sm hover:bg-muted transition-colors cursor-pointer"
              title="Trocar arquivo"
            >
              <Icons.FileSpreadsheet className="w-4 h-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{file.name}</span>
              <Icons.RefreshCw className="w-3 h-3 shrink-0 text-muted-foreground" />
            </button>
          ) : (
            <span className="text-sm text-muted-foreground">Nenhum arquivo selecionado</span>
          )}
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setShowFields(v => !v)} aria-expanded={showFields}>
              <Icons.List className="w-3.5 h-3.5" />
              Campos
              <Icons.ChevronDown className={cn('w-3 h-3 transition-transform', showFields && 'rotate-180')} />
            </Button>
            <Button variant="ghost" size="sm" onClick={downloadTemplate}>
              <Icons.Download className="w-3.5 h-3.5" />
              Modelo
            </Button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
        </div>

        {/* Fields — click a column to copy its name */}
        {showFields && (
          <div className="px-5 py-3 border-b border-border bg-muted/20 shrink-0 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                Clique para copiar · <Icons.KeyRound className="inline w-3 h-3" /> chave · <span className="text-foreground font-medium">negrito</span> obrigatório na criação · <Icons.List className="inline w-3 h-3" /> valores aceitos
              </span>
              <button
                type="button"
                onClick={() => copy(columns.map(c => c.name).join(';'), 'Cabeçalho')}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                <Icons.Copy className="w-3 h-3" />
                Copiar cabeçalho
              </button>
            </div>
            <div className="max-h-40 overflow-y-auto space-y-2">
              {columnGroups.map(g => (
                <div key={g.key} className="space-y-1">
                  {g.label && (
                    <div className="text-xs text-muted-foreground">
                      {g.label} <span className="opacity-70">— opcional; se informado, os em negrito são obrigatórios</span>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {g.columns.map(c => (
                      <span
                        key={c.name}
                        className={cn(
                          'flex items-center h-6 rounded-sm border text-xs font-mono overflow-hidden',
                          c.key ? 'border-primary/50 bg-primary/10' : 'border-border bg-background',
                          valuesOf === c.name && 'ring-1 ring-ring',
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => copy(c.name, c.name)}
                          title={`${c.label} — ${columnHint(c)}`}
                          className={cn(
                            'flex items-center gap-1 px-2 h-full transition-colors cursor-pointer hover:bg-muted',
                            c.required ? 'font-semibold text-foreground' : 'text-muted-foreground',
                          )}
                        >
                          {c.key && <Icons.KeyRound className="w-3 h-3" />}
                          {c.name}
                        </button>
                        {!!c.values?.length && (
                          <button
                            type="button"
                            onClick={() => { setValuesOf(v => (v === c.name ? null : c.name)); setValueQuery('') }}
                            title="Valores aceitos"
                            className="px-1.5 h-full border-l border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                          >
                            <Icons.List className="w-3 h-3" />
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Accepted values of the selected column — click one to copy it */}
            {valuesColumn && (
              <div className="rounded-sm border border-border bg-background">
                <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border">
                  <span className="text-xs text-muted-foreground">
                    Valores aceitos em <code className="font-mono text-foreground">{valuesColumn.name}</code>
                    {valuesColumn.type === 'list' && ' — vários separados por |'}
                  </span>
                  {(valuesColumn.values?.length ?? 0) > 12 && (
                    <input
                      value={valueQuery}
                      onChange={(e) => setValueQuery(e.target.value)}
                      placeholder="Filtrar…"
                      className="ml-auto h-6 w-40 rounded-sm border border-input bg-input-bg px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => setValuesOf(null)}
                    className={cn('text-muted-foreground hover:text-foreground transition-colors cursor-pointer', (valuesColumn.values?.length ?? 0) <= 12 && 'ml-auto')}
                  >
                    <Icons.X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="max-h-44 overflow-y-auto px-3 py-2 space-y-2">
                  {valueGroups.map(g => (
                    <div key={g.group} className="space-y-1">
                      {g.group && <div className="text-[11px] font-medium text-muted-foreground">{g.group}</div>}
                      <div className="flex flex-wrap gap-1.5">
                        {g.values.map(v => (
                          <button
                            key={v.value}
                            type="button"
                            onClick={() => copy(v.value, v.value)}
                            className="flex items-center gap-1.5 px-2 h-6 rounded-sm border border-border text-xs hover:bg-muted transition-colors cursor-pointer"
                          >
                            <span className="font-mono">{v.value}</span>
                            {v.label !== v.value && <span className="text-muted-foreground">{v.label}</span>}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                  {!valueGroups.length && <div className="text-xs text-muted-foreground py-2">Nenhum valor encontrado</div>}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 min-h-0 flex flex-col">
          {busy === 'check' ? (
            <div className="h-72 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Icons.Loader2 className="w-4 h-4 animate-spin" />
              Validando arquivo…
            </div>
          ) : failure || result?.errors.length ? (
            <div className="m-5 rounded-sm border border-destructive/40 bg-destructive/5 px-4 py-3 space-y-1">
              <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                <Icons.AlertCircle className="w-4 h-4 shrink-0" />
                Arquivo não pôde ser lido
              </div>
              {failure && <p className="text-xs">{failure}</p>}
              <ul className="text-xs space-y-0.5 list-disc pl-5">
                {result?.errors.map((e, i) => <li key={i}>{e.message}</li>)}
              </ul>
            </div>
          ) : !result ? (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className={cn(
                'm-5 h-56 flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed text-sm transition-colors cursor-pointer',
                dragging ? 'border-primary bg-primary/5 text-foreground' : 'border-border text-muted-foreground hover:bg-muted/40',
              )}
            >
              <Icons.Upload className="w-6 h-6" />
              <span>Arraste o arquivo CSV aqui ou clique para selecionar</span>
              <span className="text-xs">Até 5.000 linhas</span>
            </button>
          ) : (
            <>
              {/* Summary */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 px-5 pt-4 shrink-0">
                {[
                  { label: 'Registros',    value: result.total },
                  { label: 'Válidos',      value: counts.valid },
                  { label: 'Com erro',     value: result.invalid, tone: result.invalid ? 'error' : undefined },
                  { label: 'Novos',        value: result.created },
                  { label: 'Atualizações', value: result.updated },
                ].map(c => (
                  <div key={c.label} className={cn('rounded-sm px-3 py-2', c.tone === 'error' ? 'bg-destructive/10' : 'bg-muted/60')}>
                    <div className={cn('text-lg font-semibold tabular-nums', c.tone === 'error' && 'text-destructive')}>{c.value}</div>
                    <div className="text-xs text-muted-foreground">{c.label}</div>
                  </div>
                ))}
              </div>

              {/* Filter + pager */}
              <div className="flex items-center justify-between gap-2 px-5 py-3 shrink-0">
                <div className="flex rounded-sm border border-border p-0.5 text-xs">
                  {([['all', 'Todos'], ['valid', 'Válidos'], ['invalid', 'Com erro']] as const).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => { setFilter(key); setPage(0) }}
                      className={cn(
                        'px-2.5 py-1 rounded-sm transition-colors cursor-pointer',
                        filter === key ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {label} <span className="tabular-nums opacity-70">{counts[key]}</span>
                    </button>
                  ))}
                </div>
                {filtered.length > PAGE_SIZE && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <span className="tabular-nums mr-1">
                      {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} de {filtered.length}
                    </span>
                    <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                      <Icons.ChevronLeft className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page >= pageCount - 1} onClick={() => setPage(p => p + 1)}>
                      <Icons.ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </div>

              {/* Preview — fixed height, scrolls inside */}
              <div className="mx-5 mb-4 h-[42vh] overflow-auto rounded-sm border border-border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 z-10 bg-muted">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium text-muted-foreground w-12">Linha</th>
                      <th className="px-2 py-1.5 text-left font-medium text-muted-foreground w-20">Ação</th>
                      {result.columns.map(h => (
                        <th key={h} className="px-2 py-1.5 text-left font-mono font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                      ))}
                      <th className="px-2 py-1.5 text-left font-medium text-muted-foreground min-w-48">Erros</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map(row => {
                      const errorCols = new Set(row.errors.map(e => e.column))
                      return (
                        <tr key={row.line} className={cn('border-t border-border', row.errors.length && 'bg-destructive/5')}>
                          <td className="px-2 py-1 tabular-nums text-muted-foreground">{row.line}</td>
                          <td className="px-2 py-1">
                            {row.errors.length ? (
                              <span className="text-destructive">Erro</span>
                            ) : row.action === 'create' ? (
                              <span className="text-emerald-600 dark:text-emerald-400">Novo</span>
                            ) : (
                              <span className="text-sky-600 dark:text-sky-400">Atualizar</span>
                            )}
                          </td>
                          {result.columns.map(h => (
                            <td
                              key={h}
                              className={cn('px-2 py-1 whitespace-nowrap max-w-56 truncate', errorCols.has(h) && 'text-destructive font-medium')}
                              title={row.values[h]}
                            >
                              {row.values[h]}
                            </td>
                          ))}
                          <td className="px-2 py-1 text-destructive">
                            {row.errors.map((e, i) => (
                              <div key={i}>{e.column && <span className="font-mono">{e.column}: </span>}{e.message}</div>
                            ))}
                          </td>
                        </tr>
                      )
                    })}
                    {!pageRows.length && (
                      <tr>
                        <td colSpan={result.columns.length + 3} className="px-2 py-8 text-center text-muted-foreground">
                          Nenhum registro neste filtro
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-5 py-3 border-t border-border shrink-0">
          <span className="text-xs text-muted-foreground mr-auto">
            {result && result.invalid > 0 && 'Corrija os erros no arquivo e carregue novamente — nada é gravado enquanto houver erro.'}
            {canSave && 'Prévia validada. Nada foi gravado ainda.'}
          </span>
          <Button variant="cancel" size="sm" onClick={onClose} disabled={!!busy}>Cancelar</Button>
          <Button size="sm" onClick={save} disabled={!canSave} title="Alt+G">
            {busy === 'save' && <Icons.Loader2 className="w-4 h-4 animate-spin" />}
            Gravar
          </Button>
        </div>
      </div>
    </div>
  )

  return typeof window !== 'undefined' ? createPortal(modal, document.body) : null
}
