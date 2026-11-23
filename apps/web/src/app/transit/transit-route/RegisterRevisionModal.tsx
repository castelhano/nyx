'use client'

import { useEffect, useState } from 'react'
import { useQuery }     from '@tanstack/react-query'
import { apiFetch }     from '@/lib/auth'
import { Button }       from '@/components/ui/button'
import { Input }        from '@/components/ui/input'
import { Icons }        from '@/lib/icons'
import { extractError } from '@/lib/utils'
import { useShortcut, useShortcutContext } from '@/lib/keywatch'
import { apiPost }      from './api'
import { DIR_LABEL, type ExtensionChanges, type RouteDirection } from './types'

interface Props {
  lineId:  string
  changes: ExtensionChanges
  onClose: () => void
  onSaved: () => void
}

function todayIso(): string {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

interface RevisionRow { id: string; validFrom: string; description: string; approvalRef: string | null }

export function fmtKm(v: number | null): string {
  return v == null ? '—' : `${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`
}

// Records the official extension change of this screen's edits as a LineRevision — the same
// date merges into the revision already registered for it (LineRevisionService.register)
export function RegisterRevisionModal({ lineId, changes, onClose, onSaved }: Props) {
  const [validFrom,   setValidFrom]   = useState(todayIso)
  const [description, setDescription] = useState('')
  const [approvalRef, setApprovalRef] = useState('')
  const [isPending,   setIsPending]   = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  // once the user types, a date with a revision no longer overwrites the fields
  const [touched,     setTouched]     = useState(false)

  // same key/shape as the line's history modal (LineHistoryModal) — invalidated on register
  const { data: revisions = [] } = useQuery({
    queryKey: ['transit', 'line-revision', { lineId }],
    queryFn:  async () => {
      const res = await apiFetch(`/transit/line-revision?lineId=${lineId}&pageSize=200`)
      return res.ok ? (((await res.json()) as { data?: RevisionRow[] }).data ?? []) : []
    },
  })
  // the revision this registration merges into — @db.Date arrives as a UTC midnight
  const existing = revisions.find((r) => r.validFrom.slice(0, 10) === validFrom) ?? null

  // untouched fields follow the chosen date's revision (adjusted during render, no effect)
  const [prevExistingId, setPrevExistingId] = useState<string | null>(null)
  if ((existing?.id ?? null) !== prevExistingId) {
    setPrevExistingId(existing?.id ?? null)
    if (!touched) {
      setDescription(existing?.description ?? '')
      setApprovalRef(existing?.approvalRef ?? '')
    }
  }

  useShortcutContext('register_revision_md')

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !isPending) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, isPending])

  async function submit() {
    if (!validFrom || description.trim().length < 2) { setError('Informe a vigência e a descrição'); return }
    setIsPending(true)
    setError(null)
    try {
      await apiPost('/transit/line-revision/register', {
        lineId, validFrom, description: description.trim(), approvalRef: approvalRef.trim() || null, extensionKm: changes,
      })
      onSaved()
    } catch (err) {
      setError(extractError(err as Record<string, unknown>, 'Erro ao registrar alteração'))
      setIsPending(false)
    }
  }

  useShortcut('alt+g', submit, {
    desc:    'Registrar',
    icon:    Icons.Save,
    context: 'register_revision_md',
    origin:  'apps/web/src/app/transit/transit-route/RegisterRevisionModal.tsx',
    enabled: !isPending,
  })

  const entries = Object.entries(changes) as [RouteDirection, NonNullable<ExtensionChanges[RouteDirection]>][]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <form
        onSubmit={(e) => { e.preventDefault(); submit() }}
        className="bg-background border border-border rounded-md shadow-lg w-full max-w-md p-6 space-y-4"
      >
        <div>
          <h2 className="text-lg font-semibold">Registrar alteração de trajeto?</h2>
          <p className="text-xs text-muted-foreground mt-1">
            A extensão oficial da linha mudou. O registro fica no histórico da linha — os planos já calculados não são alterados.
          </p>
        </div>

        <div className="border border-border rounded-sm divide-y divide-border text-sm">
          {entries.map(([dir, km]) => (
            <div key={dir} className="flex items-center justify-between px-3 py-2">
              <span className="font-medium">{DIR_LABEL[dir]}</span>
              <span className="tabular-nums">
                <span className="text-muted-foreground">{fmtKm(km.from)}</span>
                <Icons.ArrowRight className="inline w-3.5 h-3.5 mx-1.5 text-muted-foreground" />
                {fmtKm(km.to)}
              </span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-[6.5rem_1fr] items-center gap-x-4 gap-y-3">
          <label htmlFor="rev-valid-from" className="text-sm font-medium">Vigência</label>
          <Input id="rev-valid-from" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} className="w-48" />

          <label htmlFor="rev-description" className="text-sm font-medium">Descrição</label>
          <Input
            id="rev-description"
            value={description}
            onChange={(e) => { setDescription(e.target.value); setTouched(true) }}
            placeholder="Ex: Trajeto alterado para atender a FEI"
            autoFocus
          />

          <label htmlFor="rev-approval-ref" className="text-sm font-medium">N Controle</label>
          <Input id="rev-approval-ref" value={approvalRef} onChange={(e) => { setApprovalRef(e.target.value); setTouched(true) }} placeholder="Opcional" className="w-48" />
        </div>

        {existing && (
          <div className="px-3 py-2 bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 rounded-sm text-xs text-sky-700 dark:text-sky-300">
            Já existe uma alteração registrada em {validFrom.split('-').reverse().join('/')} — este registro será juntado a ela, e a descrição e o N Controle acima substituem os dela.
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="cancel" tabIndex={-1} onClick={onClose} disabled={isPending}>Cancelar</Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Registrando…' : 'Registrar'}
          </Button>
        </div>
      </form>
    </div>
  )
}
