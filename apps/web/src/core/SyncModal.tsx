'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useForm, FormProvider } from 'react-hook-form'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { X, Upload, Loader2, CheckCircle, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiFetch, getToken } from '@/lib/auth'
import { FieldRenderer } from './FieldRenderer'
import { Button } from '@/components/ui/button'
import type { MetadataField } from '@nyx/types'

interface SyncField extends MetadataField {}

interface JobProgress {
  processed: number
  total:     number
  current:   string
}

interface JobResult {
  id:          string
  status:      'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED'
  output?:     { created?: number; updated?: number; deactivated?: number; errors?: unknown[]; progress?: JobProgress } | null
  error?:      string | null
  durationMs?: number | null
}

interface Props {
  domain:        string
  resource:      string
  label:         string
  submitLabel?:  string
  outputLabels?: { created: string; updated: string; deactivated: string }
  onClose:       () => void
}

export function SyncModal({ domain, resource, label, submitLabel = 'Sincronizar', outputLabels, onClose }: Props) {
  const ol = { created: 'Criados', updated: 'Atualizados', deactivated: 'Desligados', ...outputLabels }
  const [file,      setFile]      = useState<File | null>(null)
  const [jobId,     setJobId]     = useState<string | null>(null)
  const [submitErr, setSubmitErr] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const fileRef    = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()

  const methods = useForm<Record<string, string>>({ defaultValues: {} })
  const { handleSubmit, register, control, formState: { errors } } = methods

  // Fetch sync fields from backend
  const { data: fieldsData } = useQuery<{ fields: SyncField[] }>({
    queryKey: ['sync-fields', domain, resource],
    queryFn:  () => apiFetch(`/${domain}/${resource}/sync/fields`).then(r => r.json()),
    staleTime: Infinity,
  })
  const fields = fieldsData?.fields ?? []

  // Poll job status after submission
  const { data: job } = useQuery<JobResult>({
    queryKey:        ['job', jobId],
    queryFn:         () => apiFetch(`/core/job/${jobId}`).then(r => r.json()),
    enabled:         !!jobId,
    refetchInterval: (q) => {
      const s = q.state.data?.status
      return s === 'PENDING' || s === 'RUNNING' ? 2000 : false
    },
  })

  // On terminal status, invalidate the resource list
  useEffect(() => {
    if (job?.status === 'COMPLETED' || job?.status === 'FAILED') {
      queryClient.invalidateQueries({ queryKey: [domain, resource] })
    }
  }, [job?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  async function onSubmit(values: Record<string, string>) {
    if (!file) { setSubmitErr('Selecione um arquivo'); return }
    setSubmitErr(null)
    setSubmitting(true)

    const form = new FormData()
    form.append('file', file)

    // Append only non-virtual real fields
    for (const f of fields) {
      if (!f.virtual && values[f.name]) {
        form.append(f.name, values[f.name])
      }
    }

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? '/api'}/${domain}/${resource}/sync`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body:    form,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.message?.message ?? body?.message ?? 'Erro ao iniciar sync')
      }
      const { jobId: id } = await res.json()
      setJobId(id)
    } catch (err: any) {
      setSubmitErr(err?.message ?? 'Erro ao enviar arquivo')
    } finally {
      setSubmitting(false)
    }
  }

  const isDone    = job?.status === 'COMPLETED' || job?.status === 'FAILED'
  const isRunning = !!jobId && !isDone

  const modal = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative bg-background border border-border rounded-lg shadow-xl w-full max-w-md flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-semibold text-base">Sincronizar {label}</h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Job polling view */}
          {jobId ? (
            <div className="space-y-4">
              {isRunning && (() => {
                const p = job?.output?.progress
                return p ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">
                        {p.processed} / {p.total}
                      </span>
                      <span className="text-muted-foreground font-medium">
                        {Math.round((p.processed / p.total) * 100)}%
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all duration-300"
                        style={{ width: `${(p.processed / p.total) * 100}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{p.current}</p>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <Loader2 className="w-5 h-5 animate-spin shrink-0" />
                    <span>Iniciando, aguarde…</span>
                  </div>
                )
              })()}

              {job?.status === 'COMPLETED' && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-emerald-500">
                    <CheckCircle className="w-5 h-5 shrink-0" />
                    Sincronização concluída
                  </div>
                  {job.output && (
                    <div className="grid grid-cols-3 gap-2 text-center">
                      {[
                        { label: ol.created,     value: job.output.created },
                        { label: ol.updated,     value: job.output.updated },
                        { label: ol.deactivated, value: job.output.deactivated },
                      ].map(({ label: l, value }) => (
                        <div key={l} className="bg-muted rounded-sm p-2">
                          <div className="text-xl font-bold">{value}</div>
                          <div className="text-xs text-muted-foreground">{l}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {job.output?.errors && (job.output.errors as any[]).length > 0 && (
                    <div className="text-xs text-destructive">
                      {(job.output.errors as any[]).length} linha(s) com erro — veja detalhes em /core/job
                    </div>
                  )}
                  {job.durationMs && (
                    <div className="text-xs text-muted-foreground">
                      Concluído em {(job.durationMs / 1000).toFixed(1)}s
                    </div>
                  )}
                </div>
              )}

              {job?.status === 'FAILED' && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                    <AlertCircle className="w-5 h-5 shrink-0" />
                    Falha no processamento
                  </div>
                  {job.error && (
                    <p className="text-xs text-muted-foreground bg-muted rounded-sm px-3 py-2">{job.error}</p>
                  )}
                </div>
              )}
            </div>
          ) : (
            /* Form view */
            <FormProvider {...methods}>
              <form id="sync-form" onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                {/* Dynamic fields */}
                {fields.length > 0 && (
                  <div className="grid grid-cols-1 gap-x-4 gap-y-1">
                    {fields.map((f) => (
                      <FieldRenderer
                        key={f.name}
                        field={f}
                        register={register(f.name, { required: f.required && !f.virtual ? 'Campo obrigatório' : false })}
                        control={control}
                        error={errors[f.name]?.message as string | undefined}
                      />
                    ))}
                  </div>
                )}

                {/* File upload */}
                <div className="space-y-1">
                  <label className="text-sm font-medium">Arquivo</label>
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-2 rounded-sm text-sm transition-colors mt-1 cursor-pointer',
                      file
                        ? 'border-border bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-muted-foreground',
                    )}
                  >
                    <Upload className="w-4 h-4 shrink-0" />
                    <span className="truncate">{file ? file.name : 'Selecionar arquivo (.txt)'}</span>
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".txt,text/plain"
                    className="hidden"
                    onChange={(e) => {
                      setFile(e.target.files?.[0] ?? null)
                      setSubmitErr(null)
                    }}
                  />
                  {submitErr && <p className="text-xs text-destructive">{submitErr}</p>}
                </div>
              </form>
            </FormProvider>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
          {isDone ? (
            <Button onClick={onClose}>Fechar</Button>
          ) : jobId ? (
            <Button variant="outline" onClick={onClose} disabled={isRunning}>Fechar</Button>
          ) : (
            <>
              <Button variant="outline" type="button" onClick={onClose}>Cancelar</Button>
              <Button type="submit" form="sync-form" disabled={submitting}>
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {submitLabel}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )

  return typeof window !== 'undefined' ? createPortal(modal, document.body) : null
}
