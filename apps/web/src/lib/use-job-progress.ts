import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { apiFetch } from '@/lib/auth'

export interface JobProgress {
  processed: number
  total:     number
  current:   string
}

export interface JobData {
  id:          string
  status:      'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED'
  output?:     { progress?: JobProgress; [key: string]: unknown } | null
  error?:      string | null
  durationMs?: number | null
}

export function useJobProgress(jobId: string | null, onDone?: (job: JobData) => void) {
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  const { data: job } = useQuery<JobData>({
    queryKey:        ['job', jobId],
    queryFn:         () => apiFetch(`/core/job/${jobId}`).then(r => r.json()),
    enabled:         !!jobId,
    refetchInterval: (q) => {
      const s = q.state.data?.status
      return s === 'PENDING' || s === 'RUNNING' ? 1000 : false
    },
  })

  // Track previous status to fire onDone exactly once per transition to terminal state
  const prevStatusRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!job) return
    if (prevStatusRef.current === job.status) return
    prevStatusRef.current = job.status
    if (job.status === 'COMPLETED' || job.status === 'FAILED') {
      onDoneRef.current?.(job)
    }
  }, [job?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    job,
    isRunning:   !!jobId && (!job || job.status === 'PENDING' || job.status === 'RUNNING'),
    isCompleted: job?.status === 'COMPLETED',
    isFailed:    job?.status === 'FAILED',
    isDone:      job?.status === 'COMPLETED' || job?.status === 'FAILED',
  }
}
