import { forwardRef, type SelectHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

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
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ size = 'default', className, wrapperClassName, children, ...props }, ref) => (
    <div className={cn('relative', wrapperClassName)}>
      <select
        ref={ref}
        className={cn(base, sizes[size], className)}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
    </div>
  ),
)

Select.displayName = 'Select'
