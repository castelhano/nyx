'use client'

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import type { EmployeeChangeEntry } from '@nyx/schemas'
import { Icons } from '@/lib/icons'
import { apiFetch } from '@/lib/auth'
import { extractError } from '@/lib/utils'
import { Button } from '@/components/ui/button'

const FIELD_LABEL: Record<string, string> = { phone: 'Telefone' }

const when = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

// The employee's tracked field changes (EmployeeChange), newest first, as a timeline
export function EmployeeChangesModal({ employeeId, onClose }: { employeeId: string; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['hr', 'employee', employeeId, 'changes'],
    queryFn:  async () => {
      const res = await apiFetch(`/hr/employee/${employeeId}/changes`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(extractError(json))
      return json as EmployeeChangeEntry[]
    },
  })

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="relative z-10 w-full max-w-lg mx-4 bg-card border border-border rounded-lg shadow-xl flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="text-base font-semibold">Histórico de alterações</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Dados de contato alterados pelo RH ou pelo próprio operador no portal</p>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
            <Icons.X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          {isLoading && <div className="flex justify-center py-6"><Icons.Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>}
          {error && <p className="text-sm text-destructive">{error.message}</p>}
          {data && !data.length && <p className="text-sm text-muted-foreground py-6 text-center">Nenhuma alteração registrada.</p>}
          {data && data.length > 0 && (
            <ol className="relative border-s border-border ms-2">
              {data.map(c => {
                const Icon = c.origin === 'PORTAL' ? Icons.Smartphone : Icons.User
                return (
                  <li key={c.id} className="ms-5 pb-5 last:pb-0">
                    <span className="absolute -start-3 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground">
                      <Icon className="w-3.5 h-3.5" />
                    </span>
                    <p className="text-xs text-muted-foreground">
                      {when(c.createdAt)} · {c.origin === 'PORTAL' ? 'Operador, pelo portal' : c.userName ?? 'RH'}
                    </p>
                    <p className="text-sm mt-0.5">
                      <span className="font-medium">{FIELD_LABEL[c.field] ?? c.field}:</span>{' '}
                      <span className="text-muted-foreground line-through">{c.oldValue ?? 'vazio'}</span>
                      <Icons.ArrowRight className="inline w-3.5 h-3.5 mx-1.5 text-muted-foreground" />
                      <span>{c.newValue ?? 'vazio'}</span>
                    </p>
                  </li>
                )
              })}
            </ol>
          )}
        </div>

        <div className="flex justify-end px-5 py-4 border-t border-border">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>Fechar</Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
