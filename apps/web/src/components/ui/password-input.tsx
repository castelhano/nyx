'use client'

import { forwardRef, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Input } from './input'
import { KeyHint } from '@/core/FieldRenderer'
import { cn } from '@/lib/utils'

interface PasswordInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  error?:   string
  keybind?: string
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ error, keybind, className, ...props }, ref) {
    const [show, setShow] = useState(false)

    return (
      <div className="space-y-1">
        <div className="relative">
          <Input
            ref={ref}
            type={show ? 'text' : 'password'}
            className={cn(keybind ? 'pr-20' : 'pr-10', className)}
            {...props}
          />
          {keybind && <KeyHint k={keybind} className="right-10" />}
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setShow((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            aria-label={show ? 'Ocultar senha' : 'Exibir senha'}
          >
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    )
  }
)
