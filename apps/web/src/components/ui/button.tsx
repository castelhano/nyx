import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

type Variant = 'default' | 'destructive' | 'outline' | 'ghost' | 'rowAction'
type Size    = 'sm' | 'default' | 'lg' | 'icon'

const variants: Record<Variant, string> = {
  default:     'bg-emerald-600 text-white hover:bg-emerald-700/90 dark:bg-emerald-800 dark:hover:bg-emerald-800/90 dark:text-emerald-50',
  // default:     'bg-primary text-primary-foreground hover:bg-primary/90',
  destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  outline:     'border border-input bg-transparent hover:bg-accent hover:text-accent-foreground',
  ghost:       'hover:bg-accent hover:text-accent-foreground',
  rowAction: 'hover:bg-muted hover:text-foreground',
}

const sizes: Record<Size, string> = {
  sm:      'h-8 px-3 text-xs',
  default: 'h-9 px-4 text-sm',
  lg:      'h-10 px-6 text-sm',
  icon:    'h-8 w-8 p-0',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?:    Size
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'default', size = 'default', className, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-sm font-medium',
        'transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
        'disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  ),
)

Button.displayName = 'Button'
