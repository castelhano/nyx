'use client'

// CSV export of a vehicle plan (Exportar Plano) or crew plan (Exportar Escala): the API
// builds the chosen model's rows (plan-csv module), this only picks the model and writes the file.

import { useEffect, useRef, useState } from 'react'
import { PLAN_CSV_MODELS, PLAN_CSV_MODEL_LABEL, type PlanCsvFile, type PlanCsvModel } from '@nyx/schemas'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Icons } from '@/lib/icons'
import { apiFetch } from '@/lib/auth'
import { downloadCsvRows } from '@/lib/csv'
import { extractError } from '@/lib/utils'
import { useShortcut, useShortcutContext } from '@/lib/keywatch'

interface Props {
  title:    string
  // GET endpoint taking ?model=
  endpoint: string
  onClose:  () => void
}

export function PlanCsvModal({ title, endpoint, onClose }: Props) {
  useShortcutContext('plan_csv_md')
  const [model, setModel]         = useState<PlanCsvModel>('SUMMARY')
  const [exporting, setExporting] = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  useShortcut('alt+g', () => formRef.current?.requestSubmit(), {
    desc:    'Exportar',
    icon:    Icons.Download,
    context: 'plan_csv_md',
    origin:  'apps/web/src/app/transit/plan-csv-modal.tsx',
  })

  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  async function handleExport(e: React.FormEvent) {
    e.preventDefault()
    if (exporting) return
    setExporting(true)
    setError(null)
    try {
      const res  = await apiFetch(`${endpoint}${endpoint.includes('?') ? '&' : '?'}model=${model}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(extractError(json))
      const file = json as PlanCsvFile
      downloadCsvRows(file.headers, file.rows, file.filename)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao exportar')
      setExporting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <form ref={formRef} onSubmit={handleExport} className="relative z-10 bg-card border border-border rounded-lg shadow-xl w-full max-w-sm mx-4 p-6 space-y-4">
        <h2 className="text-base font-semibold">{title}</h2>

        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">Modelo</span>
          <Select size="sm" value={model} onChange={e => setModel(e.target.value as PlanCsvModel)} autoFocus>
            {PLAN_CSV_MODELS.map(m => <option key={m} value={m}>{PLAN_CSV_MODEL_LABEL[m]}</option>)}
          </Select>
        </label>

        {error && (
          <p className="flex gap-2 text-sm text-red-600 dark:text-red-400"><Icons.AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{error}</p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="cancel" size="sm" tabIndex={-1} onClick={onClose}>Cancelar</Button>
          <Button type="submit" size="sm" disabled={exporting}>
            {exporting ? 'Gerando…' : 'Exportar'}
          </Button>
        </div>
      </form>
    </div>
  )
}
