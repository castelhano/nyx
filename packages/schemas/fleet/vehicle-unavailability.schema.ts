import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

// A vehicle out of service over a date range — see VehicleUnavailability in fleet.prisma
export const vehicleUnavailabilitySchema = withMeta(
  z.object({
    id: z.uuid().meta({ listVisibility: 'hidden' }),

    vehicleId: z.uuid().meta({ label: 'Veículo', showInForm: false, listVisibility: 'hidden' }),

    startDate: z.date().meta({
      label:          'De',
      listVisibility: 'visible',
      filter:         { type: 'date_range' },
      className:      'md:w-1/4',
      defaultValue:   '$today',
      keybind:        'd',
    }),

    endDate: z.date().optional().nullable().meta({
      label:          'Até',
      helpText:       'Vazio: sem previsão de retorno.',
      listVisibility: 'visible',
      className:      'md:w-1/4',
    }),

    reason: z.string().min(2).meta({
      label:          'Motivo',
      placeholder:    'Ex.: Manutenção preventiva',
      listVisibility: 'visible',
      className:      'md:w-1/2',
      keybind:        'm',
    }),

    notes: z.string().optional().meta({
      label:          'Observações',
      widget:         'textarea',
      listVisibility: 'never',
    }),

    createdAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
    updatedAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  {
    label:       'Indisponibilidade',
    labelPlural: 'Indisponibilidades',
    nameField:   'reason',
    nameFirstWord: false,
    icon:        'Wrench',
    defaultSort: { field: 'startDate', order: 'desc' },
    breadcrumb:  [
      { resource: 'vehicle', contextField: 'vehicleId', listLabel: 'Veículos', nameField: 'code', keybind: 'f8' },
    ],
  },
)

export const createVehicleUnavailabilitySchema = vehicleUnavailabilitySchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateVehicleUnavailabilitySchema  = createVehicleUnavailabilitySchema.partial()

export type VehicleUnavailability          = z.infer<typeof vehicleUnavailabilitySchema>
export type CreateVehicleUnavailabilityDto = z.infer<typeof createVehicleUnavailabilitySchema>
export type UpdateVehicleUnavailabilityDto = z.infer<typeof updateVehicleUnavailabilitySchema>
