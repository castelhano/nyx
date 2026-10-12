import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'
import { externalCodesSchema } from './plan-export/external-system'

export const CREW_ABSENCE_EFFECTS = ['ABSENCE', 'DAY_OFF', 'COMP_OFF'] as const
export type CrewAbsenceEffect = typeof CREW_ABSENCE_EFFECTS[number]

export const CREW_ABSENCE_EFFECT_LABEL: Record<CrewAbsenceEffect, string> = {
  ABSENCE:  'Ausência — indisponível no dia, reduz a carga',
  DAY_OFF:  'Folga semanal',
  COMP_OFF: 'Folga compensada — reduz a carga',
}

// the system types (systemKey) — the roster's own days off, and férias (which may name a ferista)
export const CREW_ABSENCE_SYSTEM_KEYS = ['WEEKLY_OFF', 'COMP_OFF', 'VACATION'] as const
export type CrewAbsenceSystemKey = typeof CREW_ABSENCE_SYSTEM_KEYS[number]

// Kind of absence or day off — see CrewAbsenceType in transit.prisma. Its effect says what it
// becomes on the roster: a request of a DAY_OFF / COMP_OFF type, once approved, puts that day off
// on the roster. The roster's own days off point at the system types (Folga semanal / Folga
// compensada) or at another type of the same effect; externalCodes carry each one's ERP code.
export const crewAbsenceTypeSchema = withMeta(
  z.object({
    id: z.uuid().meta({ listVisibility: 'hidden' }),

    code: z.string().min(1).max(10).meta({
      label:          'Código',
      listVisibility: 'visible',
      className:      'md:w-28',
      keybind:        'c',
    }),

    name: z.string().min(2).meta({
      label:          'Nome',
      listVisibility: 'visible',
      className:      'md:w-1/2',
      keybind:        'n',
    }),

    effect: z.enum(CREW_ABSENCE_EFFECTS).default('ABSENCE').meta({
      label:          'Na escala',
      listVisibility: 'visible',
      filter:         true,
      defaultValue:   'ABSENCE',
      className:      'md:w-96',
      optionLabels:   CREW_ABSENCE_EFFECT_LABEL,
    }),

    // set by the system — its types can't be deleted nor change their effect
    systemKey: z.enum(CREW_ABSENCE_SYSTEM_KEYS).nullable().optional().meta({
      label:          'Tipo do sistema',
      showInForm:     false,
      listVisibility: 'hidden',
    }),

    requestable: z.boolean().default(false).meta({
      label:          'Pode ser solicitada pelo operador',
      widget:         'switch',
      listVisibility: 'visible',
      defaultValue:   false,
    }),

    isActive: z.boolean().default(true).meta({
      label:          'Ativo',
      widget:         'switch',
      listVisibility: 'visible',
      filter:         true,
      defaultValue:   true,
    }),

    externalCodes: externalCodesSchema,

    createdAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
    updatedAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  {
    label:       'Tipo de Ausência',
    labelPlural: 'Tipos de Ausência',
    nameField:   'name',
    icon:        'CalendarX',
  },
)

export const createCrewAbsenceTypeSchema = crewAbsenceTypeSchema.omit({ id: true, createdAt: true, updatedAt: true, systemKey: true })
export const updateCrewAbsenceTypeSchema  = createCrewAbsenceTypeSchema.partial()

export type CrewAbsenceType          = z.infer<typeof crewAbsenceTypeSchema>
export type CreateCrewAbsenceTypeDto = z.infer<typeof createCrewAbsenceTypeSchema>
export type UpdateCrewAbsenceTypeDto = z.infer<typeof updateCrewAbsenceTypeSchema>
