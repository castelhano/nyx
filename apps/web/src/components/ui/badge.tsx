import { cn } from '@/lib/utils'

export type BadgeColor = 'success' | 'warning' | 'destructive' | 'info' | 'muted'

const BADGE_COLOR_CLS: Record<BadgeColor, string> = {
  success:     'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  warning:     'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400',
  destructive: 'bg-destructive/15 text-destructive',
  info:        'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  muted:       'bg-muted text-muted-foreground',
}

export function Badge({ label, color, className }: { label: string; color?: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center justify-center rounded-sm px-2 py-0.5 text-xs font-medium', BADGE_COLOR_CLS[(color as BadgeColor) ?? 'muted'], className)}>
      {label}
    </span>
  )
}
