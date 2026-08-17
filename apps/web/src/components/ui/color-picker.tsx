'use client'

import { cn } from '@/lib/utils'
import { Icons } from '@/lib/icons'

interface ColorPickerProps {
  value:      string | null
  onChange:   (color: string | null) => void
  palette:    string[]
  // when set, renders an extra swatch that clears the selection (value = null) —
  // used for "inherit the default color" instead of picking one explicitly
  autoColor?:  string
  autoLabel?:  string
  disabled?:   boolean
  className?:  string
}

function Swatch({ color, selected, title, disabled, onClick }: {
  color: string; selected: boolean; title: string; disabled?: boolean; onClick: () => void
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'w-7 h-7 rounded-full border-2 flex items-center justify-center transition-colors cursor-pointer',
        selected ? 'border-foreground' : 'border-transparent hover:border-muted-foreground',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
      style={{ backgroundColor: color }}
    >
      {selected && <Icons.Check className="w-3.5 h-3.5 text-white drop-shadow" />}
    </button>
  )
}

// Palette-constrained color picker — swatches only, no free hex input. `palette`
// controls the option set, so the same component serves a short curated list
// (e.g. route colors) or a larger extended set elsewhere.
export function ColorPicker({ value, onChange, palette, autoColor, autoLabel = 'Automático', disabled, className }: ColorPickerProps) {
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {autoColor && (
        <Swatch
          color={autoColor}
          title={autoLabel}
          selected={value === null}
          disabled={disabled}
          onClick={() => onChange(null)}
        />
      )}
      {palette.map((color) => (
        <Swatch
          key={color}
          color={color}
          title={color}
          selected={value === color}
          disabled={disabled}
          onClick={() => onChange(color)}
        />
      ))}
    </div>
  )
}
