'use client'

import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ThemeName } from '@nyx/types'

interface ThemeMeta {
  label: string
}

const themes: Record<ThemeName, ThemeMeta> = {
  eucalyptus: { label: 'Eucalyptus' },
  ocean:      { label: 'Ocean'      },
  sunset:     { label: 'Sunset'     },
  lavender:   { label: 'Lavender'   },
  rose:       { label: 'Rose'       },
  slate:      { label: 'Slate'      },
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
      {/* Swatch — theme class scopes the CSS variables to this theme's values */}
      <div className={cn('flex items-end gap-1.5', `theme-${theme}`)}>
        <div
          className="h-7 w-7 rounded-md shadow-sm flex items-center justify-center text-xs"
          style={{ backgroundColor: 'hsl(var(--accent))', color: 'hsl(var(--accent-foreground))' }}
        >
          Aa
        </div>
        <div
          className="h-4 w-4 rounded-sm shadow-sm"
          style={{ backgroundColor: 'hsl(var(--ring))' }}
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
