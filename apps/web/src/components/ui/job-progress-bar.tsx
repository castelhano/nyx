'use client'

import { Loader2, CheckCircle, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { JobData, JobProgress } from '@/lib/use-job-progress'

interface Props {
  job?:         JobData
  isRunning:    boolean
  isCompleted:  boolean
  isFailed:     boolean
  className?:   string
}

export function JobProgressBar({ job, isRunning, isCompleted, isFailed, className }: Props) {
  if (!isRunning && !isCompleted && !isFailed) return null

  const progress = job?.output?.progress as JobProgress | undefined
  const pct      = progress ? Math.round((progress.processed / progress.total) * 100) : 0

  return (
    <div className={cn('space-y-1.5 text-sm', className)}>
      {isRunning && (
        progress ? (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{progress.processed} / {progress.total}</span>
              <span className="font-medium">{pct}%</span>
            </div>
            <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            {progress.current && (
              <p className="text-xs text-muted-foreground truncate">{progress.current}</p>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            <span className="text-xs">Processando…</span>
          </div>
        )
      )}

      {isCompleted && (
        <div className="flex items-center gap-2 text-emerald-500">
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span className="text-xs">
            Concluído{job?.durationMs ? ` em ${(job.durationMs / 1000).toFixed(1)}s` : ''}
          </span>
        </div>
      )}

      {isFailed && (
        <div className="flex items-center gap-2 text-destructive">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="text-xs">{job?.error ?? 'Falha no processamento'}</span>
        </div>
      )}
    </div>
  )
}
