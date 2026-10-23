import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'
import { vehicleTypeSchema, VEHICLE_TYPE_LABELS } from '../transit/vehicle-type'

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
      className:  'md:w-1/2',
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
      className:           'md:w-1/2',
    }),

    code: z.string().min(1).max(20).meta({
      label:          'Prefixo',
      listVisibility: 'visible',
      className:      'md:w-36',
      keybind:        'c',
    }),

    plate: z.string().min(7).max(8).meta({
      label:          'Placa',
      listVisibility: 'visible',
      className:      'md:w-36',
      placeholder:    'AAA-0A00'
    }),

    renavam: z.string().optional().meta({
      label:          'Renavam',
      listVisibility: 'hidden',
      className:      'md:w-80',
      placeholder:    '00000000000'
    }),

    chassis: z.string().optional().meta({
      label:          'Chassi',
      listVisibility: 'hidden',
      className:      'md:w-80',
      placeholder:    '00000000000000000',
    }),

    brandId: z.uuid().optional().meta({
      label:          'Marca',
      widget:         'select',
      resource:       'vehicle-brand',
      domain:         'fleet',
      labelField:     'name',
      listVisibility: 'hidden',
      filter:         { type: 'relation', endpoint: 'fleet/vehicle-brand', labelField: 'name' },
      className:      'md:w-80',
    }),

    modelId: z.uuid().optional().meta({
      label:          'Modelo',
      widget:         'select',
      resource:       'vehicle-model',
      domain:         'fleet',
      labelField:     'name',
      dependsOn:      'brandId',
      listVisibility: 'hidden',
      filter:         { type: 'relation', endpoint: 'fleet/vehicle-model', labelField: 'name', dependsOn: 'brandId' },
      className:      'md:w-80',
    }),

    year: z.number().int().min(1900).max(2100).optional().meta({
      label:     'Ano Fabricação',
      listVisibility: 'hidden',
      className:      'md:w-36',
    }),

    modelYear: z.number().int().min(1900).max(2100).optional().meta({
      label:     'Ano Modelo',
      listVisibility: 'hidden',
      className:      'md:w-36',
    }),

    vehicleType: vehicleTypeSchema.meta({
      label:          'Tipo',
      listVisibility: 'visible',
      filter:         true,
      defaultValue:   'STANDARD',
      className:      'md:w-48',
      keybind:        'p',
      optionLabels:   VEHICLE_TYPE_LABELS,
    }),

    color: z.string().optional().meta({
      label:     'Cor',
      listVisibility: 'hidden',
      className:      'md:w-48',
      placeholder:    'Cor'
    }),

    fuelType: z.enum(['DIESEL', 'GASOLINE', 'ETHANOL', 'ELECTRIC', 'HYBRID', 'GNV']).meta({
      label:        'Combustível',
      listVisibility: 'hidden',
      filter:       true,
      defaultValue: 'DIESEL',
      className:    'md:w-48',
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
      listVisibility: 'hidden',
      className:      'md:w-48',
      optionLabels: {
        MANUAL:        'Manual',
        AUTOMATIC:     'Automático',
        SEMI_AUTOMATIC: 'Semi-automático',
      },
    }),

    seatedCapacity: z.number().int().positive().optional().meta({
      label:     'Cap. Sentados',
      listVisibility: 'hidden',
      className:      'md:w-48',
    }),

    totalCapacity: z.number().int().positive().optional().meta({
      label:     'Cap. Total',
      listVisibility: 'hidden',
      className:      'md:w-48',
    }),

    odometer: z.number().min(0).default(0).meta({
      label:     'Quilometragem',
      listVisibility: 'hidden',
      keybind:        'd',
      className:      'md:w-48',
    }),

    status: z.enum(['ACTIVE', 'MAINTENANCE', 'INACTIVE', 'DECOMMISSIONED']).meta({
      label:          'Status',
      listVisibility: 'visible',
      filter:         true,
      defaultValue:   'ACTIVE',
      className:      'md:w-48',
      keybind:        's',
      optionLabels: {
        ACTIVE:         'Ativo',
        MAINTENANCE:    'Manutenção',
        INACTIVE:       'Inativo',
        DECOMMISSIONED: 'Desativado',
      },
    }),

    acquisitionDate: z.date().optional().meta({
      label:   'Aquisição',
      listVisibility: 'hidden',
      className:      'md:w-48',
    }),

    acquisitionValue: z.number().positive().optional().meta({
      label:     'Valor de Aquisição',
      widget:    'currency',
      listVisibility: 'hidden',
      className:      'md:w-48',
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
    label:       'Veiculo',
    labelPlural: 'Veiculos',
    nameField:   'code',
    icon:        'Bus',
    defaultSort: { field: 'code', order: 'asc' },
    importKey:   'code',
    // every enum value appears at least once — the file is how users learn the accepted values
    importExamples: [
      {
        code: '1001', branch: 'Filial Centro', plate: 'ABC1D23', renavam: '12345678901', chassis: '9BWZZZ377VT004251',
        brand: 'Volvo', model: 'B270F', year: '2022', modelYear: '2023', vehicleType: 'STANDARD', color: 'Branco',
        fuelType: 'DIESEL', transmission: 'AUTOMATIC', seatedCapacity: '40', totalCapacity: '80', odometer: '125430,5',
        status: 'ACTIVE', acquisitionDate: '15/03/2022', acquisitionValue: '850000,00', notes: 'Exemplo completo',
      },
      { code: '1003', branch: 'Filial Centro', plate: 'DEF2G34', vehicleType: 'ARTICULATED',    fuelType: 'GNV',      transmission: 'SEMI_AUTOMATIC', status: 'MAINTENANCE' },
      { code: '1004', branch: 'Filial Centro', plate: 'GHI3J45', vehicleType: 'BI_ARTICULATED', fuelType: 'ELECTRIC', transmission: 'AUTOMATIC',      status: 'INACTIVE' },
      { code: '1005', branch: 'Filial Centro', plate: 'JKL4M56', vehicleType: 'MICRO_BUS',      fuelType: 'HYBRID',   transmission: 'MANUAL',         status: 'DECOMMISSIONED' },
      { code: '1006', branch: 'Filial Centro', plate: 'MNO5P67', vehicleType: 'MINIBUS',        fuelType: 'ETHANOL',  transmission: 'MANUAL',         status: 'ACTIVE' },
      { code: '1007', branch: 'Filial Centro', plate: 'PQR6S78', vehicleType: 'VAN',            fuelType: 'GASOLINE', transmission: 'MANUAL',         status: 'ACTIVE' },
      { code: '1002', branch: 'Filial Centro', plate: 'XYZ9K87', notes: 'Mínimo para criar: os demais assumem o padrão' },
      { code: '0950', odometer: '130000', notes: 'Prefixo já cadastrado: atualiza só as células preenchidas' },
    ],
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
