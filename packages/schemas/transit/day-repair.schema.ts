import { z } from 'zod'
import { CREW_ROLES } from './duty.schema'

// "Reparar" on the Escala screen — fixes the period's pendências changing as little as it can
// (docs/architecture/transit/rostering.md). crew: duties without anyone, or with someone who
// can't be there; vehicles: blocks without a car, or with one that can't run them. Each target
// gets the options found — the first one proposed, or none when the user has to pick (quadro
// insuficiente) — and confirming applies the chosen ones.

export const DAY_REPAIR_KINDS = ['crew', 'vehicles'] as const
export type DayRepairKind = typeof DAY_REPAIR_KINDS[number]

export const DAY_REPAIR_LABEL: Record<DayRepairKind, string> = {
  crew:     'Cobrir tabelas',
  vehicles: 'Encaixar veículos',
}

// how an option solves its target, in the order they're tried
export const REPAIR_OPTION_KINDS = ['FREE', 'SWAP', 'SWAP2', 'COMP_OFF', 'STANDBY', 'SPARE', 'TYPE_SWAP'] as const
export type RepairOptionKind = typeof REPAIR_OPTION_KINDS[number]

export const REPAIR_OPTION_LABEL: Record<RepairOptionKind, string> = {
  FREE:      'Livre no dia',
  SWAP:      'Troca',
  SWAP2:     'Troca em dois níveis',
  COMP_OFF:  'Cancelar folga compensada',
  STANDBY:   'Reduzir plantão',
  SPARE:     'Carro livre',
  TYPE_SWAP: 'Giro de tipo',
}

// One write, with what it expects to find (`from`) — the apply refuses the option when the day
// changed since. crew: the duty's holder; vehicle: the block's car; compOff: a generated folga
// compensada removed (the day becomes a working one).
export const repairStepSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('crew'),    dutyId: z.uuid(),  from: z.uuid().nullable(), to: z.uuid().nullable() }),
  z.object({ type: z.literal('vehicle'), blockId: z.uuid(), from: z.uuid().nullable(), to: z.uuid().nullable() }),
  z.object({ type: z.literal('compOff'), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), crewMemberId: z.uuid() }),
])
export type RepairStep = z.infer<typeof repairStepSchema>

export interface RepairOption {
  kind:  RepairOptionKind
  // in words: "30010 Alexandre", "30022 Soares (M8 → M12) · 30044 Gil na M8"
  text:  string
  // what it costs: "plantão das 05:00 fica sem operador", "carga +7h50"
  notes: string[]
  steps: RepairStep[]
  // crew members whose day changes — notified on a PUBLISHED day
  affected: string[]
}

export interface RepairItem {
  id:        string
  date:      string
  // "M12 · 05:10–13:40" / "Bloco 12"
  label:     string
  // the pendência: "Operador com ausência aprovada", "Tabela sem operador"
  reason:    string
  // who / which car is there now
  current:   string | null
  published: boolean
  options:   RepairOption[]
  // the option proposed — null: the user picks one (or leaves it), or there is none
  proposed:  number | null
  // why nothing solves it
  unsolved:  string | null
}

export interface DayRepairProposal {
  kind:  DayRepairKind
  from:  string
  to:    string
  items: RepairItem[]
}

export const dayRepairQuerySchema = z.object({
  branchId: z.uuid(),
  role:     z.enum(CREW_ROLES).default('DRIVER'),
  from:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})
export type DayRepairQuery = z.infer<typeof dayRepairQuerySchema>

// the chosen options' steps, in order
export const dayRepairApplySchema = dayRepairQuerySchema.extend({
  steps: z.array(repairStepSchema).min(1, 'Nenhuma opção escolhida'),
})
export type DayRepairApplyDto = z.infer<typeof dayRepairApplySchema>
