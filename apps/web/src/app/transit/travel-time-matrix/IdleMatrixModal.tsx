'use client'

import { useEffect, useState } from 'react'
import { EXTERNAL_CODE_SYSTEMS, EXTERNAL_CODE_SYSTEM_LABEL, type ExternalCodeSystem, type IdleMatrixExport, type IdleMatrixLocality } from '@nyx/schemas'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { apiFetch } from '@/lib/auth'
import { useConfirm } from '@/lib/confirm-context'
import { Icons } from '@/lib/icons'
import { useShortcutContext } from '@/lib/keywatch'
import { useToast } from '@/lib/toast-context'
import { extractError } from '@/lib/utils'

// Idle matrix download (docs/architecture/transit/osrm.md "Idle matrix export"). The only choice
// is which code system depots go under; what the receiving system wouldn't know is shown before
// the download.

const CONTEXT = 'idle_matrix_md'
const NYX     = ''

export function IdleMatrixModal({ onClose }: { onClose: () => void }) {
  useShortcutContext(CONTEXT)
  const { toast } = useToast()
  const confirm   = useConfirm()
  const [depotCodes, setDepotCodes] = useState<ExternalCodeSystem | typeof NYX>(NYX)
  const [busy, setBusy]             = useState(false)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  async function handleDownload() {
    setBusy(true)
    try {
      const query = depotCodes ? `?depotCodes=${depotCodes}` : ''
      const res   = await apiFetch(`/transit/travel-time-matrix/export/idle-matrix${query}`)
      const json  = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(extractError(json))
      const matrix = json as IdleMatrixExport

      const list  = (items: IdleMatrixLocality[]) => items.map(l => `${l.code} ${l.name}`).join(', ')
      const notes = [
        depotCodes && matrix.depotsWithoutCode.length ? `Garagens sem código ${EXTERNAL_CODE_SYSTEM_LABEL[depotCodes]}, exportadas com o código do nyx: ${list(matrix.depotsWithoutCode)}.` : '',
        matrix.omitted.length ? `Fora da matriz, sem viagem em plano em vigor: ${list(matrix.omitted)}.` : '',
      ].filter(Boolean)
      if (notes.length) {
        const ok = await confirm({ title: 'Baixar matriz de ociosos?', description: notes.map(n => `• ${n}`).join('\n\n'), confirmLabel: 'Baixar', variant: 'default' })
        if (!ok) return
      }

      const suffix = depotCodes ? `-${depotCodes.toLowerCase()}` : ''
      const url    = URL.createObjectURL(new Blob([matrix.csv], { type: 'text/csv;charset=utf-8' }))
      Object.assign(document.createElement('a'), { href: url, download: `matriz-ociosos${suffix}.csv` }).click()
      URL.revokeObjectURL(url)
      toast.success(`${matrix.rows} pares exportados`)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao exportar a matriz')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 bg-card border border-border rounded-lg shadow-xl w-full max-w-md mx-4 flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold">Matriz de ociosos</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground">
            <Icons.X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-2 text-sm">
          <label className="font-medium" htmlFor="idle-matrix-depot-codes">Códigos das garagens</label>
          <Select
            id="idle-matrix-depot-codes"
            size="sm"
            autoFocus
            value={depotCodes}
            onChange={e => setDepotCodes(e.target.value as ExternalCodeSystem | typeof NYX)}
          >
            <option value={NYX}>nyx</option>
            {EXTERNAL_CODE_SYSTEMS.map(system => <option key={system} value={system}>{EXTERNAL_CODE_SYSTEM_LABEL[system]}</option>)}
          </Select>
          <p className="text-xs text-muted-foreground">Demais localidades seguem usando código do local.</p>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border">
          <Button size="sm" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button size="sm" onClick={handleDownload} disabled={busy}>Baixar</Button>
        </div>
      </div>
    </div>
  )
}
