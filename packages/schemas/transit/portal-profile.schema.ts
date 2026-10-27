import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

// What the crew of an empresa may do in the crew portal — see PortalProfile in transit.prisma.
// A crew member follows his profile, else the empresa's default one (isDefault), else
// DEFAULT_PORTAL_PERMISSIONS; CrewMember.portalOverride replaces the fields it sets (a quota list
// whole — it never merges item by item).

export const PORTAL_QUOTA_PERIODS = ['WEEK', 'MONTH', 'YEAR'] as const
export type PortalQuotaPeriod = typeof PORTAL_QUOTA_PERIODS[number]
// MONTH follows roster.loadPeriodStartDay; WEEK is Monday–Sunday; YEAR the calendar year
export const PORTAL_QUOTA_PERIOD_LABEL: Record<PortalQuotaPeriod, string> = { WEEK: 'Semana', MONTH: 'Mês', YEAR: 'Ano' }

// a request quota — requests in the period, each portal request one day; no maximum = no quota
const quotaSchema = z.object({
  period:      z.enum(PORTAL_QUOTA_PERIODS).default('MONTH').meta({ label: 'Período', optionLabels: PORTAL_QUOTA_PERIOD_LABEL }),
  maxRequests: z.number().int().min(0).optional().meta({ label: 'Máximo de pedidos' }),
})
export type PortalQuota = z.infer<typeof quotaSchema>

export const portalPermissionsSchema = z.object({
  viewRoster:         z.boolean().default(true).meta({ label: 'Ver a escala' }),
  requestAbsence:     z.boolean().default(false).meta({ label: 'Pedir ausência (tipos solicitáveis)' }),
  requestTimeWindow:  z.boolean().default(false).meta({ label: 'Pedir restrição de horário' }),
  editPreferredLines: z.boolean().default(false).meta({ label: 'Editar linhas preferidas' }),
  // per absence type (its code)
  absenceLimits: z.record(z.string(), quotaSchema).default({})
    .meta({ label: 'Cotas por tipo de ausência', resource: 'crew-absence-type', domain: 'transit', keyField: 'code', labelField: 'name', keyLabel: 'Tipo de ausência' }),
  timeWindowLimit: quotaSchema.optional().meta({ label: 'Cota de restrição de horário' }),
})
export type PortalPermissions = z.infer<typeof portalPermissionsSchema>

export const DEFAULT_PORTAL_PERMISSIONS: PortalPermissions = portalPermissionsSchema.parse({})

// what a crew member may do: his profile's (else the defaults) with his own fields over it
export function effectivePortalPermissions(profile: unknown, override: unknown): PortalPermissions {
  const parsed = profile == null ? null : portalPermissionsSchema.safeParse(profile)
  const base = parsed?.success ? parsed.data : DEFAULT_PORTAL_PERMISSIONS
  if (override == null || typeof override !== 'object') return base
  const own = Object.fromEntries(Object.entries(override).filter(([, v]) => v !== undefined && v !== null))
  const merged = portalPermissionsSchema.safeParse({ ...base, ...own })
  return merged.success ? merged.data : base
}

export const portalProfileSchema = withMeta(
  z.object({
    id: z.uuid().meta({ listVisibility: 'hidden' }),

    branchId: z.uuid('Selecione a empresa').meta({
      label:          'Empresa',
      widget:         'select',
      resource:       'branch',
      domain:         'core',
      labelField:     'name',
      className:      'md:w-1/2',
      listVisibility: 'visible',
      filter:         { type: 'relation', endpoint: 'core/branch', labelField: 'name' },
    }),

    name: z.string().min(2).meta({
      label:          'Nome',
      listVisibility: 'visible',
      className:      'md:w-1/2',
      keybind:        'n',
    }),

    isDefault: z.boolean().default(false).meta({
      label:          'Padrão da empresa',
      helpText:       'Vale para os operadores da empresa sem perfil. Um por empresa.',
      widget:         'switch',
      listVisibility: 'visible',
      defaultValue:   false,
    }),

    permissions: portalPermissionsSchema.default(DEFAULT_PORTAL_PERMISSIONS).meta({
      label:          'Permissões',
      widget:         'object-editor',
      showInForm:     true,
      listVisibility: 'never',
    }),

    createdAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
    updatedAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  {
    label:       'Perfil do Portal',
    labelPlural: 'Perfis do Portal',
    nameField:   'name',
    icon:        'IdCard',
  },
)

export const createPortalProfileSchema = portalProfileSchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updatePortalProfileSchema  = createPortalProfileSchema.partial()

export type PortalProfile          = z.infer<typeof portalProfileSchema>
export type CreatePortalProfileDto = z.infer<typeof createPortalProfileSchema>
export type UpdatePortalProfileDto = z.infer<typeof updatePortalProfileSchema>
