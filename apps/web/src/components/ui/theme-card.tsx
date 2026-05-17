'use client'

import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ThemeName } from '@nyx/types'

interface ThemeMeta {
  label:   string
  accent:  string  // HSL values for the accent swatch
  ring:    string  // HSL values for the ring swatch
}

const themes: Record<ThemeName, ThemeMeta> = {
  eucalyptus: { label: 'Eucalyptus', accent: '158 18% 36%', ring: '158 38% 50%' },
  ocean:      { label: 'Ocean',      accent: '210 30% 38%', ring: '210 65% 55%' },
  sunset:     { label: 'Sunset',     accent: '20 35% 38%',  ring: '20 65% 55%'  },
  lavender:   { label: 'Lavender',   accent: '258 20% 42%', ring: '258 50% 62%' },
  rose:       { label: 'Rosa',       accent: '340 25% 38%', ring: '340 55% 58%' },
  slate:      { label: 'Slate',      accent: '215 8% 36%',  ring: '215 25% 55%' },
}

interface ThemeCardProps {
  theme:    ThemeName
  selected: boolean
  onSelect: () => void
}

export function ThemeCard({ theme, selected, onSelect }: ThemeCardProps) {
  const meta = themes[theme]

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'relative flex flex-col items-center gap-2.5 rounded-lg border p-4 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected
          ? 'border-ring bg-card shadow-sm'
          : 'border-border bg-card hover:border-muted-foreground hover:bg-accent/20',
      )}
    >
      {/* Swatch */}
      <div className="flex items-end gap-1.5">
        <div
          className="h-7 w-7 rounded-md shadow-sm"
          style={{ backgroundColor: `hsl(${meta.accent})` }}
        />
        <div
          className="h-4 w-4 rounded-sm shadow-sm"
          style={{ backgroundColor: `hsl(${meta.ring})` }}
        />
      </div>

      <span className="text-xs font-medium text-foreground">{meta.label}</span>

      {selected && (
        <span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="h-2.5 w-2.5" strokeWidth={3} />
        </span>
      )}
    </button>
  )
}

export { themes as themesMeta }
