import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const departmentSchema = withMeta(
  z.object({
    id:        z.uuid().meta({listVisibility: 'hidden'}),
    name:      z.string().min(2).meta({ label: 'Nome', listVisibility: 'visible', keybind: 'g', className: 'md:w-64' }),
    createdAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
    updatedAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  {
    label:       'Setor',
    labelPlural: 'Setores',
    nameField:   'name',
    icon:        'Layers',
    defaultSort: { field: 'name', order: 'asc' },
  },
)

export const createDepartmentSchema = departmentSchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateDepartmentSchema = createDepartmentSchema.partial()

export type Department          = z.infer<typeof departmentSchema>
export type CreateDepartmentDto = z.infer<typeof createDepartmentSchema>
export type UpdateDepartmentDto = z.infer<typeof updateDepartmentSchema>
