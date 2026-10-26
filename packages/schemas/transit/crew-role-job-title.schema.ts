import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'
import { CREW_ROLES, CREW_ROLE_LABEL } from './duty.schema'

// Which job titles are crew of a role — see CrewRoleJobTitle in transit.prisma. An active
// employee whose current contract has a mapped title should have a CrewMember of that role (the
// Painel de Escala flags who hasn't). Several titles may map to the same role (Motorista Pleno,
// Motorista Micro… → Motorista); a title maps to one role at most.
export const crewRoleJobTitleSchema = withMeta(
  z.object({
    id: z.uuid().meta({ listVisibility: 'hidden' }),

    jobTitleId: z.uuid().meta({
      label:          'Cargo',
      widget:         'select',
      resource:       'job-title',
      domain:         'hr',
      labelField:     'name',
      listVisibility: 'visible',
      filter:         { type: 'relation', endpoint: 'hr/job-title', labelField: 'name' },
      className:      'md:w-1/2',
      keybind:        'c',
    }),

    role: z.enum(CREW_ROLES).default('DRIVER').meta({
      label:          'Função',
      listVisibility: 'visible',
      filter:         true,
      defaultValue:   'DRIVER',
      className:      'md:w-1/4',
      optionLabels:   CREW_ROLE_LABEL,
      keybind:        'f',
    }),

    createdAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
    updatedAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  {
    label:       'Cargo da Função',
    labelPlural: 'Cargos das Funções',
    nameField:   'jobTitleId',
    icon:        'Briefcase',
  },
)

export const createCrewRoleJobTitleSchema = crewRoleJobTitleSchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateCrewRoleJobTitleSchema  = createCrewRoleJobTitleSchema.partial()

export type CrewRoleJobTitle          = z.infer<typeof crewRoleJobTitleSchema>
export type CreateCrewRoleJobTitleDto = z.infer<typeof createCrewRoleJobTitleSchema>
export type UpdateCrewRoleJobTitleDto = z.infer<typeof updateCrewRoleJobTitleSchema>
