import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const passwordPolicySchema = withMeta(
  z.object({
    minLength:        z.number().int().min(1).max(128).default(8).meta({ label: 'Comprimento mínimo',    helpText: 'Número mínimo de caracteres exigidos na senha', widget: 'stepper', min: 1, max: 128 }),
    requireUppercase: z.boolean().default(false).meta({ label: 'Letras maiúsculas',    helpText: 'Exige ao menos uma letra maiúscula (A–Z)', widget: 'switch' }),
    requireNumbers:   z.boolean().default(false).meta({ label: 'Números',              helpText: 'Exige ao menos um dígito (0–9)',           widget: 'switch' }),
    requireSpecial:   z.boolean().default(false).meta({ label: 'Caracteres especiais', helpText: 'Exige ao menos um símbolo (!@#$…)',        widget: 'switch' }),
    historyCount:     z.number().int().min(0).max(24).default(0).meta({ label: 'Histórico de senhas', helpText: 'Impede reutilização das últimas N senhas. 0 = desativado', widget: 'stepper', min: 0, max: 24 }),
    expiresInDays:    z.number().int().min(0).default(0).meta({ label: 'Expiração (dias)',           helpText: 'Força troca de senha após N dias. 0 = não expira',      widget: 'stepper', min: 0 }),
  }),
  {
    label:       'Política de Senha',
    labelPlural: 'Política de Senha',
    nameField:   'minLength',
    icon:        'Lock',
    groups: {
      'Comprimento':           ['minLength'],
      'Complexidade':          ['requireUppercase', 'requireNumbers', 'requireSpecial'],
      'Histórico e expiração': ['historyCount', 'expiresInDays'],
    },
  },
)

export type PasswordPolicy          = z.infer<typeof passwordPolicySchema>
export type UpsertPasswordPolicyDto = z.infer<typeof passwordPolicySchema>
