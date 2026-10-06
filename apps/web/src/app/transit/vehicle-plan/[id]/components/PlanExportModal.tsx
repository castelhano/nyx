'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  EXPORT_LAYOUTS, EXTERNAL_SYSTEMS, EXTERNAL_SYSTEM_LABEL, formatExport, layoutPositions, validateExport,
  type ExportFields, type ExportIssue, type ExportLayoutField, type ExportOptions, type ExportPreview,
  type ExportRowKind, type ExportValidationError, type ExternalSystem,
} from '@nyx/schemas'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Tabs, type TabsHandle } from '@/components/ui/tabs'
import { Icons } from '@/lib/icons'
import { apiFetch } from '@/lib/auth'
import { extractError, cn } from '@/lib/utils'
import { downloadCsvRows } from '@/lib/csv'
import { useToast } from '@/lib/toast-context'
import { useConfirm } from '@/lib/confirm-context'
import { useShortcut, useShortcutContext } from '@/lib/keywatch'

// Plan export to an external system (docs/proposal/plan_globus_export_v1.md). The preview is
// mandatory: the file is built here, from the preview as edited, with the system's layout.

const CONTEXT = 'plan_export_md'
const PREVIEW_TAB = 2

const ROW_KIND_LABEL: Record<ExportRowKind, string> = {
  TRIP:         'Viagem',
  DISPLACEMENT: 'Deslocamento',
  BREAK:        'Intervalo',
  SHIFT_CHANGE: 'Troca de turno',
  RETURN:       'Recolhe',
  END:          'Fim do trecho',
}

interface Props {
  planId:   string
  planName: string
  lineIds:  string[]
  onClose:  () => void
}

type Path = { program: number; carro?: number; table?: number; row?: number }
const errorKey = (p: Path, field: string) => [p.program, p.carro ?? '', p.table ?? '', p.row ?? '', field].join('.')

export function PlanExportModal({ planId, planName, lineIds, onClose }: Props) {
  useShortcutContext(CONTEXT)
  const { toast } = useToast()
  const confirm   = useConfirm()
  const tabsRef   = useRef<TabsHandle>(null)

  const [system, setSystem]         = useState<ExternalSystem>('GLOBUS')
  // null = not chosen yet, falls back to the default from the options
  const [crewPlanChoice, setCrewPlanId] = useState<string | null>(null)
  const [branchChoice, setBranchId]     = useState<string | null>(null)
  const [codeChoices, setCodes]         = useState<Record<string, string>>({})
  const [preview, setPreview]       = useState<ExportPreview | null>(null)
  const [edited, setEdited]         = useState(false)
  const [loading, setLoading]       = useState(false)

  const def = EXPORT_LAYOUTS[system]

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const { data: options, isLoading, error } = useQuery<ExportOptions>({
    queryKey: ['transit', 'vehicle-plan', planId, 'plan-export', 'options', lineIds],
    queryFn:  async () => {
      const res = await apiFetch(`/transit/vehicle-plan/${planId}/plan-export/options?lineIds=${lineIds.join(',')}`)
      if (!res.ok) throw new Error(extractError(await res.json().catch(() => ({}))))
      return res.json()
    },
  })

  // defaults: ACTIVE crew plan (listed first), the only operator, the program codes from
  // the pinned schedules
  const crewPlanId = crewPlanChoice ?? options?.crewPlans[0]?.id ?? ''
  const branchId   = branchChoice ?? (options?.operators.length === 1 ? options.operators[0].branchId : '')
  const codes      = useMemo(
    () => ({ ...Object.fromEntries((options?.programs ?? []).map(p => [p.lineId, p.defaultCode])), ...codeChoices }),
    [options, codeChoices],
  )

  const errors = useMemo(() => preview ? validateExport(def, preview) : [], [def, preview])
  const errorByKey = useMemo(() => new Map(errors.map(e => [errorKey(e, e.field), e.message])), [errors])

  // any parameter change discards the preview (and its edits, after confirming)
  async function changeParam(apply: () => void) {
    if (preview && edited) {
      const ok = await confirm({ title: 'Descartar o preview?', description: 'As edições feitas no preview serão perdidas.' })
      if (!ok) return
    }
    apply()
    setPreview(null)
    setEdited(false)
  }

  const canPreview = !!options && !!crewPlanId && !!branchId && !loading
  async function handlePreview() {
    if (!canPreview) return
    if (preview && edited) {
      const ok = await confirm({ title: 'Gerar o preview novamente?', description: 'As edições feitas no preview serão perdidas.' })
      if (!ok) return
    }
    setLoading(true)
    try {
      const res = await apiFetch(`/transit/vehicle-plan/${planId}/plan-export/preview`, {
        method: 'POST',
        body:   JSON.stringify({ system, crewPlanId, branchId, lineIds, programCodes: codes }),
      })
      if (!res.ok) throw new Error(extractError(await res.json().catch(() => ({}))))
      setPreview(await res.json())
      setEdited(false)
      tabsRef.current?.switchTo(PREVIEW_TAB)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao gerar o preview')
    } finally {
      setLoading(false)
    }
  }

  const canGenerate = !!preview && errors.length === 0
  function handleGenerate() {
    if (!preview || !canGenerate) return
    const blob = new Blob([formatExport(def, preview)], { type: 'text/plain;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    const name = (planName || 'planejamento').replace(/[^\w\-. ]+/g, '_')
    Object.assign(document.createElement('a'), { href: url, download: `${name}.txt` }).click()
    URL.revokeObjectURL(url)
  }

  useShortcut('alt+g', handleGenerate, {
    desc: 'Gerar arquivo', icon: Icons.Download, context: CONTEXT,
    origin: 'apps/web/src/app/transit/vehicle-plan/[id]/components/PlanExportModal.tsx',
  })

  function editTable(p: number, c: number, t: number, field: string, value: string) {
    setPreview(prev => prev && updateAt(prev, p, c, t, null, field, value))
    setEdited(true)
  }
  function editRow(p: number, c: number, t: number, r: number, field: string, value: string) {
    setPreview(prev => prev && updateAt(prev, p, c, t, r, field, value))
    setEdited(true)
  }

  const exportTab = (
    <div className="space-y-4">
      {def.notice && (
        <div className="flex items-start gap-2 rounded-sm border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <Icons.Info className="w-4 h-4 mt-0.5 shrink-0" />
          {def.notice}
        </div>
      )}

      {isLoading ? (
        <div className="text-sm text-muted-foreground py-6 text-center">Carregando…</div>
      ) : error ? (
        <div className="text-sm text-destructive py-6 text-center">{(error as Error).message}</div>
      ) : options && options.crewPlans.length === 0 ? (
        <div className="text-sm text-muted-foreground py-6 text-center">
          Este planejamento não tem escala. A escala define as trocas de turno e é obrigatória para exportar.
        </div>
      ) : options && (
        <>
          <div className="grid grid-cols-[8rem_1fr] items-center gap-x-3 gap-y-3 text-sm">
            <label className="font-medium">Sistema</label>
            <Select size="sm" value={system} onChange={e => changeParam(() => setSystem(e.target.value as ExternalSystem))} wrapperClassName="max-w-xs">
              {EXTERNAL_SYSTEMS.map(s => <option key={s} value={s}>{EXTERNAL_SYSTEM_LABEL[s]}</option>)}
            </Select>

            <label className="font-medium">Escala</label>
            <Select size="sm" value={crewPlanId} onChange={e => changeParam(() => setCrewPlanId(e.target.value))} wrapperClassName="max-w-xs">
              {options.crewPlans.map(cp => (
                <option key={cp.id} value={cp.id}>{cp.description || 'Escala'}{cp.status === 'ACTIVE' ? ' (ativa)' : cp.status === 'SUPERSEDED' ? ' (substituída)' : ''}</option>
              ))}
            </Select>

            <label className="font-medium">Operador</label>
            <Select size="sm" value={branchId} onChange={e => changeParam(() => setBranchId(e.target.value))} wrapperClassName="max-w-xs">
              <option value="" disabled>Selecione…</option>
              {options.operators.map(o => <option key={o.branchId} value={o.branchId}>{o.label}</option>)}
            </Select>
          </div>

          {options.blocksWithoutOperator > 0 && (
            <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
              <Icons.AlertTriangle className="w-4 h-4 shrink-0" />
              {options.blocksWithoutOperator} carro(s) sem operador não serão exportados.
            </div>
          )}

          <div className="space-y-2">
            <p className="text-sm font-medium">Programações</p>
            <div className="grid grid-cols-[8rem_1fr] items-center gap-x-3 gap-y-2 text-sm">
              {options.programs.map(p => (
                <ProgramCodeInput
                  key={`${p.lineId}:${codes[p.lineId] ?? ''}`}
                  lineCode={p.lineCode}
                  value={codes[p.lineId] ?? ''}
                  field={def.layout.find(f => f.level === 'program')!}
                  onChange={v => changeParam(() => setCodes(prev => ({ ...prev, [p.lineId]: v })))}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 bg-card border border-border rounded-lg shadow-xl w-full max-w-6xl mx-4 h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold">Exportar Planejamento</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground">
            <Icons.X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <Tabs
            ref={tabsRef}
            tabs={[
              { label: 'Schema', content: <SchemaTab def={def} system={system} /> },
              { label: 'Exportar', content: exportTab },
              {
                label:      'Preview',
                errorCount: errors.length || undefined,
                content:    preview
                  ? <PreviewTab def={def} preview={preview} errorByKey={errorByKey} onEditTable={editTable} onEditRow={editRow} />
                  : <div className="text-sm text-muted-foreground py-6 text-center">Gere o preview na aba Exportar.</div>,
              },
            ]}
          />
        </div>

        <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-border">
          <div className="text-xs text-muted-foreground">
            {preview && <PreviewStats preview={preview} errors={errors} />}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>Fechar</Button>
            <Button variant="outline" onClick={handlePreview} disabled={!canPreview}>
              {loading ? 'Gerando…' : 'Gerar Preview'}
            </Button>
            <Button onClick={handleGenerate} disabled={!canGenerate} title={preview ? undefined : 'Gere o preview primeiro'}>
              <Icons.Download className="w-4 h-4" /> Gerar
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ProgramCodeInput({ lineCode, value, field, onChange }: { lineCode: string; value: string; field: ExportLayoutField; onChange: (v: string) => void }) {
  // remounted (key) when the committed value changes
  const [draft, setDraft] = useState(value)
  const invalid = !draft || draft.length > field.size
  return (
    <>
      <label className="text-muted-foreground">{lineCode}</label>
      <div className="flex items-center gap-2">
        <Input
          size="sm"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => { if (draft !== value) onChange(draft) }}
          className={cn('w-40 font-mono', invalid && 'border-destructive')}
        />
        {invalid && <span className="text-xs text-destructive">{draft ? `Máximo de ${field.size} caracteres` : 'Obrigatório'}</span>}
      </div>
    </>
  )
}

function SchemaTab({ def, system }: { def: typeof EXPORT_LAYOUTS[ExternalSystem]; system: ExternalSystem }) {
  const positions = layoutPositions(def.layout)
  const rows = def.availableFields.map(name => {
    const i = def.layout.findIndex(f => f.field === name)
    return i < 0 ? { name, used: false as const } : { name, used: true as const, pos: positions[i], f: def.layout[i] }
  })

  function downloadSchema() {
    downloadCsvRows(
      ['Campo', 'Posição inicial', 'Tamanho', 'Máscara'],
      def.layout.map((f, i) => [f.field, positions[i], f.size, f.mask ?? '']),
      `layout-${system.toLowerCase()}`,
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Layout do arquivo — configure a importação no {EXTERNAL_SYSTEM_LABEL[system]} com estes campos.
        </p>
        <Button size="sm" variant="outline" onClick={downloadSchema}>
          <Icons.Download className="w-4 h-4" /> CSV
        </Button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground border-b border-border">
            <th className="py-2 pr-4 font-medium">Campo</th>
            <th className="py-2 pr-4 font-medium">Posição</th>
            <th className="py-2 pr-4 font-medium">Tamanho</th>
            <th className="py-2 font-medium">Máscara</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {rows.map(r => (
            <tr key={r.name} className={cn('border-b border-border/50', !r.used && 'text-muted-foreground/50')}>
              <td className="py-1.5 pr-4">{r.name}</td>
              <td className="py-1.5 pr-4">{r.used ? r.pos : '—'}</td>
              <td className="py-1.5 pr-4">{r.used ? r.f.size : '—'}</td>
              <td className="py-1.5">{r.used ? r.f.mask ?? '' : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PreviewStats({ preview, errors }: { preview: ExportPreview; errors: ExportValidationError[] }) {
  const carros = preview.programs.reduce((n, p) => n + p.carros.length, 0)
  const tables = preview.programs.reduce((n, p) => n + p.carros.reduce((m, c) => m + c.tables.length, 0), 0)
  const rows   = preview.programs.reduce((n, p) => n + p.carros.reduce((m, c) => m + c.tables.reduce((k, t) => k + t.rows.length, 0), 0), 0)
  return (
    <span>
      {preview.programs.length} programação(ões) · {carros} carros · {tables} tabelas · {rows} linhas
      {errors.length > 0 && <span className="text-destructive"> · {errors.length} erro(s)</span>}
    </span>
  )
}

interface PreviewTabProps {
  def:         typeof EXPORT_LAYOUTS[ExternalSystem]
  preview:     ExportPreview
  errorByKey:  Map<string, string>
  onEditTable: (p: number, c: number, t: number, field: string, value: string) => void
  onEditRow:   (p: number, c: number, t: number, r: number, field: string, value: string) => void
}

function PreviewTab({ def, preview, errorByKey, onEditTable, onEditRow }: PreviewTabProps) {
  const tableFields = def.layout.filter(f => f.level === 'table')
  const rowFields   = def.layout.filter(f => f.level === 'row')
  const programField = def.layout.find(f => f.level === 'program')!

  if (preview.programs.every(p => p.carros.length === 0)) {
    return <div className="text-sm text-muted-foreground py-6 text-center">Nenhum carro deste operador nas linhas selecionadas.</div>
  }

  return (
    <div className="space-y-6">
      <IssueList issues={preview.issues} />
      {preview.programs.map((program, p) => (
        <section key={program.lineId} className="space-y-2">
          <div className="flex items-baseline gap-3">
            <h3 className="text-sm font-semibold">Linha {program.lineCode}</h3>
            <span className="text-xs text-muted-foreground font-mono">{program.fields[programField.field]}</span>
            {errorByKey.get(errorKey({ program: p }, programField.field)) && (
              <span className="text-xs text-destructive">Programação: {errorByKey.get(errorKey({ program: p }, programField.field))}</span>
            )}
          </div>
          <IssueList issues={program.issues} />
          {program.carros.length === 0 && <p className="text-xs text-muted-foreground">Nenhum carro deste operador.</p>}
          {program.carros.map((carro, c) => (
            <div key={carro.blockId} className="rounded-sm border border-border">
              <div className="flex items-center gap-3 px-3 py-1.5 bg-muted/40 text-xs">
                <span className="font-semibold">Carro {carro.number}</span>
                <span className="text-muted-foreground">bloco {carro.blockNumber}</span>
              </div>
              <div className="px-3 py-2 space-y-2">
                <IssueList issues={carro.issues} />
                {carro.tables.map((table, t) => (
                  <PreviewTable
                    key={t}
                    tableFields={tableFields}
                    rowFields={rowFields}
                    fields={table.fields}
                    fallback={table.fallback}
                    rows={table.rows}
                    issues={table.issues}
                    tableError={f => errorByKey.get(errorKey({ program: p, carro: c, table: t }, f))}
                    rowError={(r, f) => errorByKey.get(errorKey({ program: p, carro: c, table: t, row: r }, f))}
                    onEditTable={(f, v) => onEditTable(p, c, t, f, v)}
                    onEditRow={(r, f, v) => onEditRow(p, c, t, r, f, v)}
                  />
                ))}
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}

interface PreviewTableProps {
  tableFields: ExportLayoutField[]
  rowFields:   ExportLayoutField[]
  fields:      ExportFields
  fallback?:   string[]
  rows:        ExportPreview['programs'][number]['carros'][number]['tables'][number]['rows']
  issues?:     ExportIssue[]
  tableError:  (field: string) => string | undefined
  rowError:    (row: number, field: string) => string | undefined
  onEditTable: (field: string, value: string) => void
  onEditRow:   (row: number, field: string, value: string) => void
}

function PreviewTable({ tableFields, rowFields, fields, fallback, rows, issues, tableError, rowError, onEditTable, onEditRow }: PreviewTableProps) {
  const [open, setOpen] = useState(false)
  const rowHasError = rows.some((_, r) => rowFields.some(f => rowError(r, f.field)))

  return (
    <div className="rounded-sm border border-border/60">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-2 py-1.5 text-xs">
        <button type="button" onClick={() => setOpen(v => !v)} className="p-0.5 rounded hover:bg-accent text-muted-foreground">
          {open ? <Icons.ChevronDown className="w-3.5 h-3.5" /> : <Icons.ChevronRight className="w-3.5 h-3.5" />}
        </button>
        {tableFields.map(f => (
          <div key={f.field} className="flex items-center gap-1">
            <span className="text-muted-foreground">{f.label}</span>
            <Cell field={f} value={fields[f.field] ?? ''} fallback={fallback?.includes(f.field)} error={tableError(f.field)} onChange={v => onEditTable(f.field, v)} />
          </div>
        ))}
        <span className="text-muted-foreground">{rows.length} linhas</span>
        {rowHasError && !open && <span className="text-destructive">erro nas linhas</span>}
      </div>
      {issues && issues.length > 0 && <div className="px-2 pb-1.5"><IssueList issues={issues} /></div>}
      {open && (
        <table className="w-full text-xs border-t border-border/60">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="px-2 py-1 font-medium">Tipo</th>
              {rowFields.map(f => <th key={f.field} className="px-2 py-1 font-medium">{f.label}</th>)}
            </tr>
          </thead>
          <tbody className="font-mono">
            {rows.map((row, r) => (
              <tr key={r} className={cn('border-t border-border/40', row.kind !== 'TRIP' && 'bg-muted/30')}>
                <td className="px-2 py-1 font-sans text-muted-foreground">{ROW_KIND_LABEL[row.kind]}</td>
                {rowFields.map(f => (
                  <td key={f.field} className="px-2 py-1">
                    <Cell field={f} value={row.fields[f.field] ?? ''} fallback={row.fallback?.includes(f.field)} error={rowError(r, f.field)} onChange={v => onEditRow(r, f.field, v)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

const FALLBACK_TITLE = 'Código do Nyx — sem código externo cadastrado'

function Cell({ field, value, fallback, error, onChange }: { field: ExportLayoutField; value: string; fallback?: boolean; error?: string; onChange: (v: string) => void }) {
  if (!field.editable) {
    return (
      <span
        className={cn('font-mono', fallback && 'underline decoration-dotted decoration-muted-foreground', error && 'text-destructive')}
        title={error ?? (fallback ? FALLBACK_TITLE : undefined)}
      >
        {value || '—'}
      </span>
    )
  }
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      title={error ?? (fallback ? FALLBACK_TITLE : undefined)}
      style={{ width: `${Math.max(field.size, 2) + 2}ch` }}
      className={cn(
        'font-mono bg-transparent border-b border-dashed border-border px-0.5 focus:outline-none focus:border-ring',
        fallback && 'decoration-dotted underline decoration-muted-foreground',
        error && 'border-destructive text-destructive',
      )}
    />
  )
}

function IssueList({ issues }: { issues?: ExportIssue[] }) {
  if (!issues?.length) return null
  return (
    <ul className="space-y-0.5">
      {issues.map((i, k) => (
        <li key={k} className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
          <Icons.AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
          {i.message}
        </li>
      ))}
    </ul>
  )
}

function updateAt(preview: ExportPreview, p: number, c: number, t: number, r: number | null, field: string, value: string): ExportPreview {
  return {
    ...preview,
    programs: preview.programs.map((program, pi) => pi !== p ? program : {
      ...program,
      carros: program.carros.map((carro, ci) => ci !== c ? carro : {
        ...carro,
        tables: carro.tables.map((table, ti) => ti !== t ? table : r == null
          ? { ...table, fields: { ...table.fields, [field]: value } }
          : { ...table, rows: table.rows.map((row, ri) => ri !== r ? row : { ...row, fields: { ...row.fields, [field]: value } }) }),
      }),
    }),
  }
}
