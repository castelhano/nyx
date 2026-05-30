import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const vehicleSchema = withMeta(
  z.object({
    id: z.uuid().meta({listVisibility: 'hidden'}),

    companyId: z.string().optional().meta({
      label:      'Empresa',
      widget:     'select',
      resource:   'company',
      domain:     'core',
      labelField: 'legalName',
      virtual:    true,
      lazyEdit:   true,
      keybind:    'q',
    }),

    branchId: z.uuid().meta({
      label:               'Filial',
      widget:              'select',
      resource:            'branch',
      domain:              'core',
      labelField:          'name',
      dependsOn:           'companyId',
      relatedDisplayFields: ['companyId'],
      listVisibility:      'visible',
      filter:              { type: 'relation', endpoint: 'core/branch', labelField: 'name' },
      lazyEdit:            true,
      keybind:             'f',
    }),

    plate: z.string().min(7).max(8).meta({
      label:          'Placa',
      listVisibility: 'visible',
      className:      'md:w-36',
      keybind:        'p',
    }),

    renavam: z.string().optional().meta({
      label:          'RENAVAM',
      listVisibility: 'hidden',
      className:      'md:w-48',
      keybind:        'r',
    }),

    chassis: z.string().optional().meta({
      label:          'Chassi',
      listVisibility: 'hidden',
      className:      'md:w-72',
      keybind:        'h',
    }),

    brandId: z.uuid().meta({
      label:          'Marca',
      widget:         'select',
      resource:       'vehicle-brand',
      domain:         'fleet',
      labelField:     'name',
      listVisibility: 'visible',
      filter:         { type: 'relation', endpoint: 'fleet/vehicle-brand', labelField: 'name' },
      keybind:        'm',
    }),

    modelId: z.uuid().meta({
      label:          'Modelo',
      widget:         'select',
      resource:       'vehicle-model',
      domain:         'fleet',
      labelField:     'name',
      dependsOn:      'brandId',
      listVisibility: 'visible',
      filter:         { type: 'relation', endpoint: 'fleet/vehicle-model', labelField: 'name', dependsOn: 'brandId' },
      keybind:        'o',
    }),

    year: z.number().int().min(1900).max(2100).meta({
      label:     'Ano Fabricação',
      className: 'md:w-40',
      keybind:   'n',
    }),

    modelYear: z.number().int().min(1900).max(2100).meta({
      label:     'Ano Modelo',
      className: 'md:w-40',
      keybind:   'e',
    }),

    vehicleType: z.enum(['BUS', 'MICRO_BUS', 'MINIBUS', 'VAN']).meta({
      label:          'Tipo',
      listVisibility: 'visible',
      filter:         true,
      className:      'md:w-48',
      keybind:        't',
      optionLabels: {
        BUS:       'Ônibus',
        MICRO_BUS: 'Micro-ônibus',
        MINIBUS:   'Miniônibus',
        VAN:       'Van',
      },
    }),

    color: z.string().optional().meta({
      label:     'Cor',
      className: 'md:w-40',
      keybind:   'c',
    }),

    fuelType: z.enum(['DIESEL', 'GASOLINE', 'ETHANOL', 'ELECTRIC', 'HYBRID', 'GNV']).meta({
      label:     'Combustível',
      filter:    true,
      className: 'md:w-44',
      keybind:   'u',
      optionLabels: {
        DIESEL:   'Diesel',
        GASOLINE: 'Gasolina',
        ETHANOL:  'Etanol',
        ELECTRIC: 'Elétrico',
        HYBRID:   'Híbrido',
        GNV:      'GNV',
      },
    }),

    transmission: z.enum(['MANUAL', 'AUTOMATIC', 'SEMI_AUTOMATIC']).optional().meta({
      label:     'Câmbio',
      className: 'md:w-48',
      keybind:   'x',
      optionLabels: {
        MANUAL:        'Manual',
        AUTOMATIC:     'Automático',
        SEMI_AUTOMATIC: 'Semi-automático',
      },
    }),

    seatedCapacity: z.number().int().positive().optional().meta({
      label:     'Cap. Sentados',
      className: 'md:w-40',
      keybind:   's',
    }),

    totalCapacity: z.number().int().positive().optional().meta({
      label:     'Cap. Total',
      className: 'md:w-40',
      keybind:   'z',
    }),

    odometer: z.number().min(0).default(0).meta({
      label:     'Quilometragem',
      className: 'md:w-44',
      keybind:   'd',
    }),

    status: z.enum(['ACTIVE', 'MAINTENANCE', 'INACTIVE', 'DECOMMISSIONED']).meta({
      label:          'Status',
      listVisibility: 'visible',
      filter:         true,
      defaultValue:   'ACTIVE',
      className:      'md:w-52',
      keybind:        'w',
      optionLabels: {
        ACTIVE:         'Ativo',
        MAINTENANCE:    'Manutenção',
        INACTIVE:       'Inativo',
        DECOMMISSIONED: 'Desativado',
      },
    }),

    acquisitionDate: z.date().optional().meta({
      label:   'Data de Aquisição',
      keybind: 'i',
    }),

    acquisitionValue: z.number().positive().optional().meta({
      label:     'Valor de Aquisição',
      widget:    'currency',
      className: 'md:w-44',
      keybind:   'v',
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
    label:       'Veículo',
    labelPlural: 'Veículos',
    nameField:   'plate',
    icon:        'Bus',
    defaultSort: { field: 'plate', order: 'asc' },
    groups: {
      'Características': ['vehicleType', 'color', 'fuelType', 'transmission', 'seatedCapacity', 'totalCapacity'],
      'Operacional':     ['odometer', 'status', 'acquisitionDate', 'acquisitionValue', 'notes'],
    },
  },
)

export const createVehicleSchema = vehicleSchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateVehicleSchema = createVehicleSchema.partial()

export type Vehicle          = z.infer<typeof vehicleSchema>
export type CreateVehicleDto = z.infer<typeof createVehicleSchema>
export type UpdateVehicleDto = z.infer<typeof updateVehicleSchema>
