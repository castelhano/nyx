'use client'

// Painel de Escala — the crew's change requests (shift / rest group, asked in the portal), oldest
// first, with whether the Painel could grant them now. Two queued that mirror each other show as a
// swap (granted together, no place needed). Staff grants one now (an adjustment of his
// move alone, through the adjust modal), approves it into the queue (the suggestions take it first
// once there is a place) or rejects it — the crew member is told in the portal either way.

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ConsoleChangeRequest, ConsoleSnapshot } from '@nyx/schemas'
import { Button } from '@/components/ui/button'
import { Icons } from '@/lib/icons'
import { apiFetch } from '@/lib/auth'
import { cn, extractError } from '@/lib/utils'
import { useToast } from '@/lib/toast-context'
import { Card, fmtDay } from './sections'

const daysSince = (iso: string) => Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86_400_000))

interface Props {
  snapshot:  ConsoleSnapshot
  canReview: boolean
  // swap: grant it together with its mirror request (r.swapWith)
  onGrant:   (r: ConsoleChangeRequest, swap?: boolean) => void
}

export function RequestsSection({ snapshot, canReview, onGrant }: Props) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const review = useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: 'QUEUED' | 'REJECTED' }) => {
      const res = await apiFetch(`/transit/console/requests/${id}/review`, {
        method: 'POST',
        body:   JSON.stringify({ branchId: snapshot.branchId, decision, notes: decision === 'REJECTED' ? notes.trim() || undefined : undefined }),
      })
      if (!res.ok) throw new Error(extractError(await res.json().catch(() => ({}))))
      return decision
    },
    onSuccess: decision => {
      setRejecting(null)
      setNotes('')
      toast.success(decision === 'QUEUED' ? 'Pedido aprovado na fila — o operador foi avisado' : 'Pedido recusado — o operador foi avisado')
      void queryClient.invalidateQueries({ queryKey: ['transit', 'console'] })
    },
    onError: err => toast.error(err instanceof Error ? err.message : 'Erro ao gravar'),
  })
  const list = snapshot.requests
  const asked = list.filter(r => r.status === 'REQUESTED')
  const queued = list.filter(r => r.status === 'QUEUED')

  const row = (r: ConsoleChangeRequest) => (
    <li key={r.id} className="py-2.5 space-y-2">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-1.5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-mono text-xs text-muted-foreground">{r.code}</span>
            <span className="font-medium">{r.name}</span>
            <span className="text-muted-foreground">· {r.kind === 'SHIFT' ? 'Turno' : 'Grupo de folga'}: {r.change}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            Pedido em {fmtDay(r.createdAt.slice(0, 10))} · {daysSince(r.createdAt)} dia(s) aguardando{r.position != null && ` · ${r.position}º na fila`}
          </div>
          {r.notes && <div className="text-xs text-muted-foreground">“{r.notes}”</div>}
        </div>
        <span className={cn('flex items-center gap-1 text-xs', r.ready ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}>
          {r.ready ? <Icons.CheckCircle className="w-3.5 h-3.5" /> : <Icons.Clock className="w-3.5 h-3.5" />}{r.reason}
        </span>
        {canReview && (
          <div className="flex items-center gap-1.5">
            {r.swapWith && (
              <Button size="sm" variant="outline" onClick={() => onGrant(r, true)} title="Os dois pedidos se invertem — atendidos juntos, sem precisar de vaga">
                <Icons.ArrowLeftRight className="w-3.5 h-3.5" />Trocar com {r.swapWith.code}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => onGrant(r)} title="Abre o ajuste só com a troca dele — data, prévia do impacto e confirmação">
              <Icons.Check className="w-3.5 h-3.5" />{r.status === 'QUEUED' ? 'Atender agora' : 'Aprovar agora'}
            </Button>
            {r.status === 'REQUESTED' && (
              <Button size="sm" variant="outline" disabled={review.isPending} onClick={() => review.mutate({ id: r.id, decision: 'QUEUED' })} title="Aprovado — entra na fila e é sugerido primeiro quando abrir vaga">
                <Icons.ClipboardList className="w-3.5 h-3.5" />Aprovar na fila
              </Button>
            )}
            <Button size="sm" variant="ghost" disabled={review.isPending} onClick={() => { setRejecting(rejecting === r.id ? null : r.id); setNotes('') }}>
              <Icons.X className="w-3.5 h-3.5" />Recusar
            </Button>
          </div>
        )}
      </div>
      {rejecting === r.id && (
        <form className="flex items-center gap-2" onSubmit={e => { e.preventDefault(); review.mutate({ id: r.id, decision: 'REJECTED' }) }}>
          <input autoFocus value={notes} onChange={e => setNotes(e.target.value)} maxLength={500} placeholder="Justificativa (aparece para o operador no portal)"
            className="h-8 flex-1 border border-input rounded-sm text-sm bg-input-bg px-2" />
          <Button size="sm" variant="destructive" type="submit" disabled={review.isPending}>Recusar pedido</Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setRejecting(null)}>Cancelar</Button>
        </form>
      )}
    </li>
  )

  return (
    <div className="space-y-4">
      <Card title="Aguardando análise" icon={Icons.ArrowLeftRight} aside={<span className="text-xs text-muted-foreground">pedidos do portal, os mais antigos primeiro</span>}>
        {!asked.length ? <p className="text-muted-foreground">Nenhum pedido aguardando análise.</p> : <ul className="divide-y divide-border">{asked.map(row)}</ul>}
      </Card>
      <Card title="Na fila" icon={Icons.ClipboardList} aside={<span className="text-xs text-muted-foreground">aprovados — atendidos quando o turno ou grupo pedido abrir vaga</span>}>
        {!queued.length ? <p className="text-muted-foreground">Nenhum pedido na fila.</p> : <ul className="divide-y divide-border">{queued.map(row)}</ul>}
      </Card>
    </div>
  )
}
