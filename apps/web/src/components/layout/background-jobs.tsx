'use client'

import { useQuery } from '@tanstack/react-query'
import { Icons } from '@/lib/icons'
import { apiFetch } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { Dropdown, DropdownItem, DropdownLabel } from '@/components/ui/dropdown'

// Background generations (crew solver, vehicle solver) of every plan — running, or ended and
// waiting to be used — next to the notifications bell, on any page. Polled: every 3 s while one
// runs, else every 15 s (a generation may start in another tab). Hidden when there's none or the
// user can't see those plans. A line opens its plan straight in the optimize modal.

interface ApiJob {
  jobId:       string
  crewPlanId?: string
  planId?:     string
  planLabel:   string
  running:     boolean
  startedAt:   number
  endedAt:     number | null
  elapsed:     number
  stopReason:  'finished' | 'user_stopped' | 'max_time' | 'no_improvement' | null
  error:       string | null
  hasProposal: boolean
}

export interface BackgroundJob extends ApiJob {
  kind: 'crew' | 'vehicle'
  href: string
}

const SOURCES = [
  { kind: 'vehicle' as const, endpoint: '/transit/vehicle-solver/jobs', label: 'Gerações de planejamento', href: (j: ApiJob) => `/transit/vehicle-plan/${j.planId}?optimize=1` },
  { kind: 'crew'    as const, endpoint: '/transit/crew-solver/jobs',    label: 'Gerações de escala',       href: (j: ApiJob) => `/transit/crew-plan/${j.crewPlanId}?optimize=1` },
]

export const BACKGROUND_JOBS_KEY = ['background-jobs'] as const

const clock = (ms: number) => {
  const s = Math.floor(ms / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

const ago = (ts: number) => {
  const min = Math.floor((Date.now() - ts) / 60_000)
  return min < 1 ? 'agora' : `há ${min} min`
}

function status(j: BackgroundJob): string {
  if (j.running)     return `gerando ${clock(j.elapsed)}`
  if (j.error)       return 'erro'
  if (j.hasProposal) return `proposta pronta${j.endedAt ? ` · ${ago(j.endedAt)}` : ''}`
  return 'sem proposta'
}

export function BackgroundJobs() {
  const { data: jobs = [] } = useQuery<BackgroundJob[]>({
    queryKey: BACKGROUND_JOBS_KEY,
    queryFn:  async () => {
      const lists = await Promise.all(SOURCES.map(async src => {
        const res = await apiFetch(src.endpoint).catch(() => null)
        if (!res?.ok) return []
        return ((await res.json()) as { jobs: ApiJob[] }).jobs.map(j => ({ ...j, kind: src.kind, href: src.href(j) }))
      }))
      return lists.flat()
    },
    refetchInterval: q => (q.state.data?.some(j => j.running) ? 3000 : 15_000),
  })
  if (!jobs.length) return null

  const running = jobs.filter(j => j.running).length
  const ready   = jobs.some(j => !j.running && j.hasProposal)

  return (
    <Dropdown
      align="end"
      trigger={
        <button
          type="button"
          className={cn(
            'relative flex h-8 items-center gap-1 rounded-md px-2',
            'text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors focus:outline-none',
          )}
          aria-label="Gerações em segundo plano"
          title="Gerações em segundo plano"
        >
          {running
            ? <Icons.Loader2 className="h-4 w-4 animate-spin" />
            : <Icons.Sparkles className="h-4 w-4" />}
          {running > 0 && <span className="text-xs font-medium tabular-nums">{running}</span>}
          {!running && ready && <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500" />}
        </button>
      }
    >
      {SOURCES.filter(src => jobs.some(j => j.kind === src.kind)).map(src => [
        <DropdownLabel key={src.kind}>{src.label}</DropdownLabel>,
        ...jobs.filter(j => j.kind === src.kind).map(j => (
        <DropdownItem key={j.jobId} href={j.href}>
          {j.running
            ? <Icons.Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
            : j.error
              ? <Icons.AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" />
              : <Icons.CheckCircle className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />}
          <span className="flex flex-col min-w-0">
            <span className="truncate">{j.planLabel}</span>
            <span className="text-xs text-muted-foreground">{status(j)}</span>
          </span>
        </DropdownItem>
        )),
      ])}
    </Dropdown>
  )
}
