import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PasswordPolicy } from '@nyx/schemas'

interface Props {
  password: string
  policy:   PasswordPolicy | null | undefined
}

export function PolicyIndicator({ password, policy }: Props) {
  if (!policy || !password) return null

  const checks = [
    { ok: password.length >= policy.minLength,        label: `Mín. ${policy.minLength} caracteres` },
    ...(policy.requireUppercase ? [{ ok: /[A-Z]/.test(password),      label: 'Letra maiúscula' }] : []),
    ...(policy.requireNumbers   ? [{ ok: /[0-9]/.test(password),      label: 'Número' }]          : []),
    ...(policy.requireSpecial   ? [{ ok: /[^A-Za-z0-9]/.test(password), label: 'Símbolo' }]       : []),
  ]

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5">
      {checks.map((c) => (
        <span
          key={c.label}
          className={cn(
            'flex items-center gap-1 text-xs transition-colors',
            c.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground',
          )}
        >
          <Check className={cn('w-3 h-3', !c.ok && 'opacity-30')} />
          {c.label}
        </span>
      ))}
    </div>
  )
}
