import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'

interface DomainCardProps {
  label:    string
  icon:     LucideIcon
  href:     string
  active?:  boolean
  badge?:   number
}

export function DomainCard({ label, icon: Icon, href, active, badge }: DomainCardProps) {
  return (
    <Link
      href={href}
      tabIndex={-1}
      className={cn(
        'flex flex-col gap-3 rounded-lg border p-4 transition-colors outline-none',
        'hover:bg-accent/40 hover:border-ring/50',
        active && 'border-ring bg-accent/20 ring-1 ring-ring',
      )}
    >
      <div className="flex items-center justify-between">
        <Icon className="h-5 w-5 text-muted-foreground" />
        {badge != null && badge > 0 && (
          <span className="rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-medium text-destructive-foreground leading-none">
            {badge}
          </span>
        )}
      </div>
      <span className="text-sm font-medium">{label}</span>
    </Link>
  )
}
