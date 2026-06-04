import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const jobSchema = withMeta(
  z.object({
    id:          z.uuid().meta({ listVisibility: 'hidden' }),
    type:        z.string().meta({ label: 'Tipo', listVisibility: 'visible', filter: true }),
    domain:      z.string().meta({ label: 'Domínio', listVisibility: 'hidden' }),
    resource:    z.string().meta({ label: 'Recurso', listVisibility: 'hidden' }),
    status:      z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED']).meta({
      label: 'Status',
      listVisibility: 'visible',
      filter: true,
      optionLabels: { PENDING: 'Pendente', RUNNING: 'Executando', COMPLETED: 'Concluído', FAILED: 'Falhou' },
    }),
    createdById: z.string().meta({
      label:          'Criado por',
      listVisibility: 'visible',
      showInForm:     false,
      widget:         'select',
      resource:       'user',
      domain:         'core',
      labelField:     'name',
    }),
    startedAt:   z.date().nullable().optional().meta({ label: 'Iniciado em',   listVisibility: 'hidden', showInForm: false }),
    completedAt: z.date().nullable().optional().meta({ label: 'Concluído em',  listVisibility: 'hidden', showInForm: false }),
    durationMs:  z.number().int().nullable().optional().meta({ label: 'Duração (ms)', listVisibility: 'hidden', showInForm: false }),
    outputFile:  z.string().nullable().optional().meta({ label: 'Arquivo',     listVisibility: 'hidden', showInForm: false }),
    error:       z.string().nullable().optional().meta({ label: 'Erro',        listVisibility: 'visible', showInForm: false }),
    createdAt:   z.date().meta({ label: 'Criado em', listVisibility: 'visible', showInForm: false }),
  }),
  {
    label:        'Job',
    labelPlural:  'Jobs',
    nameField:    'type',
    icon:         'ClipboardList',
    allowCsv:     false,
    defaultSort:  { field: 'createdAt', order: 'desc' },
  },
)

export type Job = z.infer<typeof jobSchema>
