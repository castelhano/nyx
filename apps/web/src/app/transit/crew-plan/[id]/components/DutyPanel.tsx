'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { formatDutyNumber, CREW_ROLES, type CrewRole } from '@nyx/schemas'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Icons } from '@/lib/icons'
import { apiFetch } from '@/lib/auth'
import { cn } from '@/lib/utils'
import type { BoardDuty, BoardBlock, BoardActivity, CrewBoardData } from '../board.types'
import {
  fmtTime, fmtDuration, parseTime, dutyColor,
  ROLE_LABEL, KIND_LABEL, ACTIVITY_LABEL, ISSUE_LABEL, STALE_LABEL,
} from '../board.types'

export const DUTY_FORM_ID = 'crew-duty-form'

export interface DutyPatch {
  role:     CrewRole
  kind:     BoardDuty['kind']
  branchId: string | null
  notes:    string | null
}

export interface ActivityInput {
  type:           BoardActivity['type']
  intervalTypeId: string | null
  startMinutes:   number
  endMinutes:     number
}

interface Props {
  duty:         BoardDuty
  blocks:       BoardBlock[]
  operators:    CrewBoardData['operators']
  localityName: (id: string) => string
  canEdit:      boolean
  // bumped by alt+l — discards unsaved form edits
  resetSignal:  number
  onSave:           (patch: DutyPatch) => void
  onDelete:         () => void
  onDeletePiece:    (pieceId: string) => void
  onAddActivity:    (input: ActivityInput) => Promise<boolean>
  onDeleteActivity: (activityId: string) => void
  onClose:          () => void
}

// Remounted per duty (key={duty.id}) and per reset, so the form's initial state is simply
// the duty as last saved.
export function DutyPanel(props: Props) {
  return <DutyPanelInner key={`${props.duty.id}:${props.resetSignal}`} {...props} />
}

function DutyPanelInner({
  duty, blocks, operators, localityName, canEdit,
  onSave, onDelete, onDeletePiece, onAddActivity, onDeleteActivity, onClose,
}: Props) {
  const [role, setRole]         = useState<CrewRole>(duty.role)
  const [kind, setKind]         = useState<BoardDuty['kind']>(duty.kind)
  const [branchId, setBranchId] = useState(duty.branchId ?? '')
  const [notes, setNotes]       = useState(duty.notes ?? '')

  const blockNumber = (id: string | null) => blocks.find(b => b.id === id)?.blockNumber
  const s = duty.summary

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onSave({ role, kind, branchId: branchId || null, notes: notes || null })
  }

  return (
    <div className="w-96 shrink-0 border-l border-border flex flex-col min-h-0 bg-background">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: dutyColor(duty) }} />
          <span className="font-semibold">{formatDutyNumber(duty.role, duty.dutyNumber)}</span>
          <span className="text-sm text-muted-foreground">{ROLE_LABEL[duty.role]}</span>
          {duty.isStale && <Badge tone="red">Desatualizada</Badge>}
          {duty.hasIssues && <Badge tone="amber">Pendências</Badge>}
        </div>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground" title="Fechar">
          <Icons.X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        <form id={DUTY_FORM_ID} onSubmit={handleSubmit} className="grid grid-cols-2 gap-2">
          <Field label="Papel">
            <Select value={role} onChange={e => setRole(e.target.value as CrewRole)} size="sm" disabled={!canEdit}>
              {CREW_ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </Select>
          </Field>
          <Field label="Tipo">
            <Select value={kind} onChange={e => setKind(e.target.value as BoardDuty['kind'])} size="sm" disabled={!canEdit}>
              {(Object.keys(KIND_LABEL) as BoardDuty['kind'][]).map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </Select>
          </Field>
          <Field label="Operador" className="col-span-2">
            <Select value={branchId} onChange={e => setBranchId(e.target.value)} size="sm" disabled={!canEdit}>
              <option value="">—</option>
              {operators.map(o => <option key={o.branchId} value={o.branchId}>{o.abbr} — {o.name}</option>)}
            </Select>
          </Field>
          <Field label="Observações" className="col-span-2">
            <textarea
              value={notes} onChange={e => setNotes(e.target.value)} rows={2} disabled={!canEdit}
              className="w-full border border-input rounded-sm text-sm bg-input-bg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </Field>
        </form>

        {s && (
          <Section title="Resumo">
            <div className="grid grid-cols-3 gap-2 text-xs">
              <Stat label="Trabalhado" value={fmtDuration(s.workMinutes)} />
              <Stat label="Pago"       value={fmtDuration(s.paidMinutes)} />
              <Stat label="Amplitude"  value={fmtDuration(s.spreadMinutes)} />
              <Stat label="Intervalo"  value={fmtDuration(s.breakMinutes)} />
              <Stat label="Extra"      value={fmtDuration(s.overtimeMinutes)} />
              <Stat label="Noturno"    value={fmtDuration(s.nightMinutes)} />
              <Stat label="Pegadas"    value={String(s.pieceCount)} />
              <Stat label="Trocas carro" value={String(s.vehicleChanges)} />
              <Stat label="Trocas linha" value={String(s.lineChanges)} />
            </div>
          </Section>
        )}

        {duty.issues.length > 0 && (
          <Section title="Pendências">
            <ul className="space-y-1 text-xs">
              {duty.issues.map((i, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <Icons.AlertTriangle className={cn('w-3.5 h-3.5 shrink-0 mt-px', i.severity === 'error' ? 'text-red-600 dark:text-red-400' : 'text-amber-500 dark:text-amber-400')} />
                  <span>
                    {ISSUE_LABEL[i.code]}
                    {i.code !== 'BRANCH_MISMATCH' && <> — {fmtTime(i.value)}{i.limit != null && <> (limite {fmtTime(i.limit)})</>}</>}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="Pegadas">
          {duty.pieces.length === 0 && <p className="text-xs text-muted-foreground">Clique num ponto de troca de um carro para adicionar.</p>}
          <ul className="space-y-1">
            {duty.pieces.map(p => (
              <li key={p.id} className={cn('flex items-center justify-between gap-2 text-xs rounded px-2 py-1 bg-muted/40', p.isStale && 'border border-dashed border-red-600')}>
                <span className="min-w-0">
                  <span className="font-medium">{blockNumber(p.vehicleBlockId) != null ? `Carro ${blockNumber(p.vehicleBlockId)}` : 'Sem bloco'}</span>
                  {' · '}{fmtTime(p.startMinutes)} {localityName(p.startLocalityId)} → {fmtTime(p.endMinutes)} {localityName(p.endLocalityId)}
                  {p.isStale && p.staleReason && <span className="block text-red-600 dark:text-red-400">{STALE_LABEL[p.staleReason]}</span>}
                </span>
                {canEdit && (
                  <button type="button" onClick={() => onDeletePiece(p.id)} className="text-muted-foreground hover:text-destructive shrink-0" title="Remover pegada">
                    <Icons.Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Atividades">
          <ul className="space-y-1">
            {duty.activities.map(a => (
              <li key={a.id} className="flex items-center justify-between gap-2 text-xs rounded px-2 py-1 bg-muted/40">
                <span>
                  <span className="font-medium">{ACTIVITY_LABEL[a.type]}</span>
                  {a.intervalTypeName && <> ({a.intervalTypeName})</>}
                  {' · '}{fmtTime(a.startMinutes)}–{fmtTime(a.endMinutes)}
                </span>
                {canEdit && (
                  <button type="button" onClick={() => onDeleteActivity(a.id)} className="text-muted-foreground hover:text-destructive" title="Remover atividade">
                    <Icons.Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {canEdit && <AddActivityForm onAdd={onAddActivity} />}
        </Section>

        {canEdit && (
          <Button type="button" variant="destructive" size="sm" onClick={onDelete}>
            <Icons.Trash2 className="w-3.5 h-3.5 me-1" /> Excluir jornada
          </Button>
        )}
      </div>
    </div>
  )
}

function AddActivityForm({ onAdd }: { onAdd: (input: ActivityInput) => Promise<boolean> }) {
  const [type, setType]   = useState<BoardActivity['type']>('BREAK')
  const [intervalTypeId, setIntervalTypeId] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd]     = useState('')

  const { data: intervalTypes = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['transit', 'interval-type', 'all'],
    queryFn:  async () => {
      const res = await apiFetch('/transit/interval-type?pageSize=999')
      if (!res.ok) return []
      const json = await res.json()
      return json.data ?? []
    },
    staleTime: 60_000,
  })

  const startMin = parseTime(start), endMin = parseTime(end)
  const valid = startMin != null && endMin != null && endMin > startMin && (type !== 'BREAK' || !!intervalTypeId)

  // its own <form> can't nest inside the duty form — plain inputs + button instead
  async function handleAdd() {
    if (!valid) return
    const ok = await onAdd({ type, intervalTypeId: type === 'BREAK' ? intervalTypeId : null, startMinutes: startMin, endMinutes: endMin })
    if (ok) { setStart(''); setEnd('') }
  }

  return (
    <div className="mt-2 grid grid-cols-2 gap-2">
      <Select value={type} onChange={e => setType(e.target.value as BoardActivity['type'])} size="sm">
        {(Object.keys(ACTIVITY_LABEL) as BoardActivity['type'][]).map(t => <option key={t} value={t}>{ACTIVITY_LABEL[t]}</option>)}
      </Select>
      <Select value={intervalTypeId} onChange={e => setIntervalTypeId(e.target.value)} size="sm" disabled={type !== 'BREAK'}>
        <option value="">Tipo de intervalo…</option>
        {intervalTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </Select>
      <input value={start} onChange={e => setStart(e.target.value)} placeholder="Início (HH:MM)" className={inputCls} />
      <input value={end} onChange={e => setEnd(e.target.value)} placeholder="Fim (HH:MM)" className={inputCls} />
      <Button type="button" size="sm" variant="outline" className="col-span-2" disabled={!valid} onClick={() => void handleAdd()}>
        <Icons.Plus className="w-3.5 h-3.5 me-1" /> Adicionar atividade
      </Button>
    </div>
  )
}

const inputCls = 'h-8 border border-input rounded-sm text-sm bg-input-bg px-2 focus:outline-none focus:ring-1 focus:ring-ring'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      {children}
    </div>
  )
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={cn('flex flex-col gap-1 text-xs text-muted-foreground', className)}>
      {label}
      {children}
    </label>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-muted/40 px-2 py-1">
      <p className="text-muted-foreground">{label}</p>
      <p className="font-medium text-foreground">{value}</p>
    </div>
  )
}

export function Badge({ tone, children }: { tone: 'red' | 'amber' | 'green'; children: React.ReactNode }) {
  const tones = {
    red:   'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    green: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  }
  return <span className={cn('text-[10px] font-medium rounded px-1.5 py-0.5', tones[tone])}>{children}</span>
}
