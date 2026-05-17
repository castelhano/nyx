import { cn } from '@/lib/utils'

interface StepperProps {
  value:      number
  onChange:   (v: number) => void
  min?:       number
  max?:       number
  disabled?:  boolean
  className?: string
}

const btnCls = [
  'flex h-8 w-8 items-center justify-center border border-input bg-background',
  'text-sm font-medium select-none transition-colors',
  'hover:bg-accent hover:text-accent-foreground',
  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
  'disabled:cursor-not-allowed disabled:opacity-60',
].join(' ')

export function Stepper({ value, onChange, min = 0, max, disabled, className }: StepperProps) {
  const clamp = (n: number) => {
    const v = Math.max(min, isNaN(n) ? min : n)
    return max !== undefined ? Math.min(max, v) : v
  }

  return (
    <div className={cn('flex items-center', className)}>
      <button
        type="button"
        disabled={disabled}
        tabIndex={-1}
        onClick={() => onChange(clamp(value - 1))}
        className={cn(btnCls, 'rounded-l-sm')}
      >−</button>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => onChange(clamp(parseInt(e.target.value, 10)))}
        className={cn(
          'h-8 w-16 border-y border-input bg-input-bg text-center text-sm',
          'focus:outline-none focus:ring-1 focus:ring-ring',
          'disabled:cursor-not-allowed disabled:opacity-60',
          '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
        )}
      />
      <button
        type="button"
        disabled={disabled}
        tabIndex={-1}
        onClick={() => onChange(clamp(value + 1))}
        className={cn(btnCls, 'rounded-r-sm')}
      >+</button>
    </div>
  )
}
