import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const jobTitleSchema = withMeta(
  z.object({
    id:           z.uuid(),
    departmentId: z.uuid().meta({ label: 'Setor', listVisibility: 'hidden', widget: 'select', resource: 'department', domain: 'hr', labelField: 'name', keybind: 'q' }),
    name:         z.string().min(2).meta({ label: 'Nome', listVisibility: 'visible', keybind: 'g' }),
    createdAt:    z.date().meta({ showInForm: false, listVisibility: 'never' }),
    updatedAt:    z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  {
    label:       'Cargo',
    labelPlural: 'Cargos',
    nameField:   'name',
    icon:        'Briefcase',
  },
)

export const createJobTitleSchema = jobTitleSchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateJobTitleSchema = createJobTitleSchema.partial()

export type JobTitle          = z.infer<typeof jobTitleSchema>
export type CreateJobTitleDto = z.infer<typeof createJobTitleSchema>
export type UpdateJobTitleDto = z.infer<typeof updateJobTitleSchema>
