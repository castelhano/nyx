import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const DUTY_PIECE_STALE_REASONS = ['BLOCK_REMOVED', 'OUT_OF_BLOCK_WINDOW', 'INVALID_RELIEF_POINT'] as const
export type DutyPieceStaleReason = typeof DUTY_PIECE_STALE_REASONS[number]

export const DUTY_PIECE_STALE_LABEL: Record<DutyPieceStaleReason, string> = {
  BLOCK_REMOVED:        'Carro removido do planejamento',
  OUT_OF_BLOCK_WINDOW:  'Passa do início ou do fim do carro',
  INVALID_RELIEF_POINT: 'O horário de troca mudou no carro',
}

// A block's relief point — where a piece may start/end. Computed by
// DutyPieceService.listReliefPoints(); the UI only offers these points and the server
// rejects pieces outside them.
export type ReliefPointKind = 'TRIP_ORIGIN' | 'TRIP_DESTINATION' | 'CREW_CHANGE_STOP' | 'DEADRUN_ORIGIN' | 'DEADRUN_DESTINATION'
export interface ReliefPoint {
  localityId: string
  minutes:    number
  kind:       ReliefPointKind
  tripId?:    string
  deadrunId?: string
}

// "Ajustar" on a stale piece (piece-adjust.ts) — why an end couldn't follow the edit:
// ANCHOR_GONE the event left the block; NO_CANDIDATE / AMBIGUOUS the fallback for ends
// without an anchor found no point / a tie; INVERTED the ends would cross
export const PIECE_ADJUST_FAILURES = ['ANCHOR_GONE', 'NO_CANDIDATE', 'AMBIGUOUS', 'INVERTED'] as const
export type PieceAdjustFailure = typeof PIECE_ADJUST_FAILURES[number]

export function pieceAdjustFailureText(side: 'start' | 'end' | null, reason: PieceAdjustFailure): string {
  const end = side === 'start' ? 'o início' : 'o fim'
  switch (reason) {
    case 'ANCHOR_GONE':  return `A viagem ou deslocamento onde estava ${end} da pegada não está mais neste carro`
    case 'NO_CANDIDATE': return `Não há ponto de troca no mesmo local para ${end} da pegada`
    case 'AMBIGUOUS':    return `Há mais de um ponto de troca possível para ${end} da pegada`
    case 'INVERTED':     return 'Os novos horários fariam a pegada terminar antes de começar'
  }
}

export const dutyPieceSchema = withMeta(
  z.object({
    id: z.uuid().meta({ listVisibility: 'hidden' }),

    dutyId: z.uuid().meta({
      label:          'Jornada',
      showInForm:     false,
      listVisibility: 'hidden',
    }),

    // null only when the block was removed from the VehiclePlan (orphan piece, stale) —
    // create/update always require a block
    vehicleBlockId: z.uuid().nullable().meta({
      label:          'Bloco',
      widget:         'select',
      resource:       'vehicle-block',
      domain:         'transit',
      labelField:     'blockNumber',
      listVisibility: 'visible',
      keybind:        'b',
    }),

    // assigned by the server in chronological order
    sequence: z.number().int().min(1).optional().meta({
      label:          'Seq.',
      showInForm:     false,
      listVisibility: 'visible',
      className:      'md:w-20',
    }),

    startMinutes: z.number().int().min(0).meta({
      label:          'Início (min)',
      listVisibility: 'visible',
      keybind:        'i',
    }),

    endMinutes: z.number().int().min(0).meta({
      label:          'Fim (min)',
      listVisibility: 'visible',
      keybind:        'f',
    }),

    startLocalityId: z.uuid().meta({
      label:          'Local de Início',
      widget:         'select',
      resource:       'transit-locality',
      domain:         'transit',
      labelField:     'name',
      listVisibility: 'visible',
    }),

    endLocalityId: z.uuid().meta({
      label:          'Local de Fim',
      widget:         'select',
      resource:       'transit-locality',
      domain:         'transit',
      labelField:     'name',
      listVisibility: 'visible',
    }),

    isStale: z.boolean().default(false).meta({
      label:          'Desatualizada',
      listVisibility: 'hidden',
      showInForm:     false,
    }),

    staleReason: z.enum(DUTY_PIECE_STALE_REASONS).optional().nullable().meta({
      label:          'Motivo',
      listVisibility: 'hidden',
      showInForm:     false,
      optionLabels: {
        BLOCK_REMOVED:        'Bloco removido',
        OUT_OF_BLOCK_WINDOW:  'Fora da janela do bloco',
        INVALID_RELIEF_POINT: 'Ponto de troca inválido',
      },
    }),

    // relief event each end sits on (`${ReliefPointKind}:${tripId | deadrunId}`) — server-kept
    startAnchor: z.string().nullable().optional().meta({ showInForm: false, listVisibility: 'never' }),
    endAnchor:   z.string().nullable().optional().meta({ showInForm: false, listVisibility: 'never' }),

    createdAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
    updatedAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  {
    label:       'Pegada',
    labelPlural: 'Pegadas',
    nameField:   'sequence',
    defaultSort: { field: 'sequence', order: 'asc' },
    breadcrumb:  [
      { resource: 'duty', contextField: 'dutyId', listLabel: 'Jornadas', nameField: 'dutyNumber' },
    ],
  },
)

export const createDutyPieceSchema = dutyPieceSchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateDutyPieceSchema  = createDutyPieceSchema.partial()

export type DutyPiece          = z.infer<typeof dutyPieceSchema>
export type CreateDutyPieceDto = z.infer<typeof createDutyPieceSchema>
export type UpdateDutyPieceDto = z.infer<typeof updateDutyPieceSchema>
