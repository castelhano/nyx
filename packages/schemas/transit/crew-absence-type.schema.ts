import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

// Kind of absence — see CrewAbsenceType in transit.prisma
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

    requestable: z.boolean().default(false).meta({
      label:          'Pode ser solicitada pelo condutor',
      widget:         'switch',
      listVisibility: 'visible',
      defaultValue:   'false',
    }),

    isActive: z.boolean().default(true).meta({
      label:          'Ativo',
      widget:         'switch',
      listVisibility: 'visible',
      filter:         true,
      defaultValue:   'true',
    }),

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

export const createCrewAbsenceTypeSchema = crewAbsenceTypeSchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateCrewAbsenceTypeSchema  = createCrewAbsenceTypeSchema.partial()

export type CrewAbsenceType          = z.infer<typeof crewAbsenceTypeSchema>
export type CreateCrewAbsenceTypeDto = z.infer<typeof createCrewAbsenceTypeSchema>
export type UpdateCrewAbsenceTypeDto = z.infer<typeof updateCrewAbsenceTypeSchema>
