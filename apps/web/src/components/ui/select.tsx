import { forwardRef, type SelectHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { KeyHint } from '@/core/FieldRenderer'

type Size = 'sm' | 'default'

const sizes: Record<Size, string> = {
  default: 'px-3 py-2',
  sm:      'px-2 py-1.5',
}

const base = [
  'appearance-none border border-input rounded-sm text-sm bg-input-bg',
  'focus:outline-none focus:ring-1 focus:ring-ring',
  'disabled:opacity-60 disabled:cursor-not-allowed',
  'pe-8',
].join(' ')

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?:             Size
  wrapperClassName?: string
  keybind?:          string
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ size = 'default', className, wrapperClassName, keybind, children, ...props }, ref) => (
    <div className={cn('relative', wrapperClassName)}>
      <select
        ref={ref}
        className={cn(base, sizes[size], 'w-full', keybind && 'md:pe-16', className)}
        {...props}
      >
        {children}
      </select>
      {keybind && <KeyHint k={keybind} className="right-8" />}
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
    </div>
  ),
)

Select.displayName = 'Select'
