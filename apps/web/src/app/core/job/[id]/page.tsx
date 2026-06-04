'use client'

import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Download } from 'lucide-react'
import { AutoBreadcrumb } from '@/core/AutoBreadcrumb'
import { usePageGuard } from '@/core/usePageGuard'
import { useRecordQuery } from '@/core/useRecordQuery'
import { useTopbarActions } from '@/components/layout/topbar-actions-context'
import { useShortcut } from '@/lib/keywatch'
import { cn } from '@/lib/utils'

type JobDetail = {
  id:          string
  type:        string
  domain:      string
  resource:    string
  status:      'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED'
  createdById: string
  createdBy?:  { id: string; name: string }
  startedAt?:  string | null
  completedAt?: string | null
  durationMs?: number | null
  input?:      unknown
  output?:     unknown
  outputFile?: string | null
  errors?:     unknown
  error?:      string | null
  createdAt:   string
}

const STATUS_LABELS: Record<string, string> = {
  PENDING:   'Pendente',
  RUNNING:   'Executando',
  COMPLETED: 'Concluído',
  FAILED:    'Falhou',
}

const STATUS_CLS: Record<string, string> = {
  PENDING:   'bg-yellow-500/15 text-yellow-400 border border-yellow-500/30',
  RUNNING:   'bg-blue-500/15 text-blue-400 border border-blue-500/30',
  COMPLETED: 'bg-green-500/15 text-green-400 border border-green-500/30',
  FAILED:    'bg-red-500/15 text-red-400 border border-red-500/30',
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${m}m ${s}s`
}

function formatDate(iso?: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR')
}

function JsonBlock({ value }: { value: unknown }) {
  if (value == null) return <span className="text-muted-foreground text-sm">—</span>
  return (
    <pre className="text-xs bg-muted/40 rounded p-3 overflow-auto max-h-64 border border-border whitespace-pre-wrap break-all">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}

const rowCls = 'flex flex-col gap-1'
const labelCls = 'text-xs text-muted-foreground uppercase tracking-wide'
const valueCls = 'text-sm text-foreground'

export default function JobDetailPage() {
  const { id }  = useParams<{ id: string }>()
  const router  = useRouter()

  const { data: job, error: jobError } = useRecordQuery<JobDetail>(
    ['core', 'job', id],
    `/core/job/${id}`,
    { staleTime: 10_000 },
  )

  const { guardNode } = usePageGuard('core', 'job', false, jobError ?? undefined)

  useTopbarActions([
    { label: 'Voltar', icon: ArrowLeft, onClick: () => router.push('/core/job'), variant: 'ghost' },
  ], [])

  useShortcut('alt+v', () => router.push('/core/job'), {
    desc:   'Voltar',
    icon:   ArrowLeft,
    origin: 'apps/web/src/app/core/job/[id]/page',
  })

  if (guardNode) return guardNode
  if (!job) return null

  const hasErrors = job.errors != null && (Array.isArray(job.errors) ? (job.errors as unknown[]).length > 0 : true)

  return (
    <div className="p-6 space-y-6">
      <AutoBreadcrumb domain="core" resource="job" id={id} recordName={job.type} />

      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">{job.type}</h1>
        <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_CLS[job.status])}>
          {STATUS_LABELS[job.status] ?? job.status}
        </span>
      </div>

      {/* Info grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6 p-4 rounded-lg border border-border bg-muted/20">
        <div className={rowCls}>
          <span className={labelCls}>Domínio / Recurso</span>
          <span className={valueCls}>{job.domain} / {job.resource}</span>
        </div>
        <div className={rowCls}>
          <span className={labelCls}>Criado por</span>
          <span className={valueCls}>{job.createdBy?.name ?? job.createdById}</span>
        </div>
        <div className={rowCls}>
          <span className={labelCls}>Criado em</span>
          <span className={valueCls}>{formatDate(job.createdAt)}</span>
        </div>
        <div className={rowCls}>
          <span className={labelCls}>Duração</span>
          <span className={valueCls}>{job.durationMs != null ? formatDuration(job.durationMs) : '—'}</span>
        </div>
        <div className={rowCls}>
          <span className={labelCls}>Iniciado em</span>
          <span className={valueCls}>{formatDate(job.startedAt)}</span>
        </div>
        <div className={rowCls}>
          <span className={labelCls}>Concluído em</span>
          <span className={valueCls}>{formatDate(job.completedAt)}</span>
        </div>
        {job.outputFile && (
          <div className={rowCls}>
            <span className={labelCls}>Arquivo gerado</span>
            <a
              href={`/api${job.outputFile}`}
              download
              className="flex items-center gap-1 text-sm text-accent hover:underline"
            >
              <Download size={13} /> Download
            </a>
          </div>
        )}
        {job.error && (
          <div className={cn(rowCls, 'col-span-2 md:col-span-4')}>
            <span className={labelCls}>Erro</span>
            <span className="text-sm text-red-400">{job.error}</span>
          </div>
        )}
      </div>

      {/* Output */}
      {job.output != null && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium">Resultado</h2>
          <JsonBlock value={job.output} />
        </div>
      )}

      {/* Errors per record */}
      {hasErrors && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-red-400">
            Erros por registro
          </h2>
          <JsonBlock value={job.errors} />
        </div>
      )}

      {/* Input */}
      {job.input != null && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Input</h2>
          <JsonBlock value={job.input} />
        </div>
      )}
    </div>
  )
}
