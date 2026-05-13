import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const passwordPolicySchema = withMeta(
  z.object({
    id:               z.string().uuid(),
    minLength:        z.number().int().min(1).max(128).meta({ label: 'Comprimento mínimo', helpText: 'Mínimo de caracteres exigidos' }),
    requireUppercase: z.boolean().meta({ label: 'Exigir letras maiúsculas' }),
    requireNumbers:   z.boolean().meta({ label: 'Exigir números' }),
    requireSpecial:   z.boolean().meta({ label: 'Exigir caracteres especiais' }),
    historyCount:     z.number().int().min(0).max(24).meta({ label: 'Histórico de senhas', helpText: '0 = não verifica repetição' }),
    expiresInDays:    z.number().int().min(0).meta({ label: 'Expiração (dias)', helpText: '0 = senha não expira' }),
    updatedAt:        z.date().meta({ showInForm: false }),
  }),
  {
    label:       'Política de Senha',
    labelPlural: 'Política de Senha',
    nameField:   'id',
    icon:        'Lock',
  },
)

export const upsertPasswordPolicySchema = passwordPolicySchema.omit({ id: true, updatedAt: true })

export type PasswordPolicy          = z.infer<typeof passwordPolicySchema>
export type UpsertPasswordPolicyDto = z.infer<typeof upsertPasswordPolicySchema>
