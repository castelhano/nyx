'use client'

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { useShortcutContext } from '@/lib/keywatch'
import type { OsoPropagationLine } from '../oso-attribute-sync-logic'

// Salvar with stopPattern/markings edits on lines pinned to a DRAFT or APPROVED OSO —
// asks whether to copy them onto the OSO too (docs/proposal/plan_oso_attribute_sync_v1.md).
// Same look as ConfirmModal, with a third way out.

interface Props {
  lines:     OsoPropagationLine[]
  badge?:    string
  onResolve: (choice: 'replicate' | 'plan' | null) => void
}

function LineList({ lines }: { lines: OsoPropagationLine[] }) {
  return (
    <ul className="space-y-0.5">
      {lines.map(l => (
        <li key={l.lineId} className="flex items-baseline gap-2 text-xs">
          <span className="font-mono font-medium">{l.lineCode}</span>
          <span className="text-muted-foreground">OSO {l.approvalRef}</span>
          <span className="text-muted-foreground ms-auto shrink-0">
            {l.trips} viage{l.trips === 1 ? 'm' : 'ns'}
            {l.sharedPlanCount > 0 && ` · usada em ${l.sharedPlanCount} outro${l.sharedPlanCount === 1 ? '' : 's'} plano${l.sharedPlanCount === 1 ? '' : 's'}`}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function OsoSavePromptModal({ lines, badge, onResolve }: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null)
  useShortcutContext('confirm_md')

  useEffect(() => { confirmRef.current?.focus() }, [])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onResolve(null)
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onResolve])

  const drafts   = lines.filter(l => l.status === 'DRAFT')
  const approved = lines.filter(l => l.status === 'APPROVED')
  const trips    = lines.reduce((n, l) => n + l.trips, 0)

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-32" role="dialog" aria-modal="true" aria-labelledby="oso-save-title">
      <div className="absolute inset-0 bg-black/50" onClick={() => onResolve(null)} />
      <div className="relative z-10 w-full max-w-md rounded-md border border-border bg-background p-6 shadow-lg flex flex-col gap-4 animate-confirm-in">
        <div className="flex flex-col gap-1">
          {badge && (
            <span className="self-start rounded px-1.5 py-0.5 text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
              {badge}
            </span>
          )}
          <h2 id="oso-save-title" className="text-base font-semibold text-foreground">Salvar alterações</h2>
          <p className="text-sm text-muted-foreground">
            {trips} viage{trips === 1 ? 'm' : 'ns'} em {lines.length} linha{lines.length === 1 ? '' : 's'} {trips === 1 ? 'alterou' : 'alteraram'} embarque ou marcações.
            Replicar também na OSO?
          </p>
        </div>

        {drafts.length > 0 && (
          <section className="flex flex-col gap-1">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">OSOs em rascunho</h3>
            <LineList lines={drafts} />
          </section>
        )}

        {approved.length > 0 && (
          <section className="flex flex-col gap-1 rounded border border-amber-500/40 bg-amber-500/5 p-2">
            <h3 className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide">OSOs aprovadas</h3>
            <LineList lines={approved} />
          </section>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" tabIndex={-1} onClick={() => onResolve(null)}>Cancelar</Button>
          <Button variant="outline" onClick={() => onResolve('plan')}>Salvar só no plano</Button>
          <Button ref={confirmRef} variant="safeConfirm" onClick={() => onResolve('replicate')}>Salvar e replicar</Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
