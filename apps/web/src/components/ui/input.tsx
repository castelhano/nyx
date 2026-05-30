import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

type Size = 'sm' | 'default'

const sizes: Record<Size, string> = {
  default: 'px-3 py-2',
  sm:      'px-2 py-1.5',
}

const baseShared = [
  'border border-input rounded-sm text-sm bg-input-bg',
  'focus:outline-none focus:ring-1 focus:ring-ring',
  'disabled:opacity-60 disabled:cursor-not-allowed',
].join(' ')

const base = `${baseShared} read-only:opacity-60 read-only:cursor-not-allowed`

// Exported for elements that can't use the component directly (IMaskInput, textarea)
export const inputBaseCls = `${base} ${sizes.default}`

// For <select> elements — omits read-only: variants (<select> always matches :read-only in CSS)
export const selectBaseCls = `${baseShared} ${sizes.default}`

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: Size
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ size = 'default', className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(base, sizes[size], className)}
      {...props}
    />
  ),
)

Input.displayName = 'Input'
