'use client'

import { useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { Icons } from '@/lib/icons'

type Size = 'sm' | 'default'

// Matches Input's own sizes (input.tsx) so a TagInput lines up with plain
// Input/Select fields placed next to it in the same form.
const sizes: Record<Size, string> = {
  default: 'px-3 py-2',
  sm:      'px-2 py-1.5',
}

const DEFAULT_SEPARATORS = [',', ';']
const STRUCTURAL_SPLIT   = ['\n', '\t'] // always split on paste, regardless of `separators`

export interface TagInputProps<T = unknown> {
  id?:                 string
  value:               string[]
  onChange:            (value: string[]) => void
  parse?:              (token: string) => T | { error: string }
  normalize?:          (raw: string) => string
  separators?:         string[]
  placeholder?:        string
  disabled?:           boolean
  size?:               Size
  className?:          string
  containerClassName?: string
  maxItems?:           number
  allowDuplicates?:    boolean
}

function isParseError(result: unknown): result is { error: string } {
  return typeof result === 'object' && result !== null && 'error' in result
}

export function TagInput<T = unknown>({
  id, value, onChange, parse, normalize, separators = DEFAULT_SEPARATORS, placeholder, disabled,
  size = 'default', className, containerClassName, maxItems, allowDuplicates = true,
}: TagInputProps<T>) {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const atMax = maxItems != null && value.length >= maxItems

  function statusOf(token: string, index: number): { valid: boolean; error?: string } {
    if (!allowDuplicates) {
      const firstIdx = value.findIndex(t => t.toLowerCase() === token.toLowerCase())
      if (firstIdx !== index) return { valid: false, error: 'Duplicado' }
    }
    if (parse) {
      const result = parse(token)
      if (isParseError(result)) return { valid: false, error: result.error }
    }
    return { valid: true }
  }

  function commit(raw: string) {
    const trimmed = raw.trim()
    setText('')
    if (!trimmed || (maxItems != null && value.length >= maxItems)) return
    onChange([...value, normalize ? normalize(trimmed) : trimmed])
  }

  function removeAt(index: number) {
    onChange(value.filter((_, i) => i !== index))
  }

  function reopen(index: number) {
    const token = value[index]
    removeAt(index)
    setText(token)
    inputRef.current?.focus()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || separators.includes(e.key)) {
      e.preventDefault()
      commit(text)
      return
    }
    if (e.key === 'Backspace' && text === '' && value.length > 0) {
      removeAt(value.length - 1)
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData('text')
    if (!pasted) return
    const splitChars = [...STRUCTURAL_SPLIT, ...separators]
    const regex = new RegExp(`[${splitChars.map(c => `\\${c}`).join('')}]`)
    const parts = pasted.split(regex).map(s => s.trim()).filter(Boolean).map(s => (normalize ? normalize(s) : s))
    if (parts.length <= 1) return // no delimiter found — let the browser paste into the text field normally
    e.preventDefault()
    setText('')
    // build the full array in one shot — calling commit() per token here would
    // have every call read the same stale `value` prop and overwrite the rest
    const room = maxItems != null ? Math.max(0, maxItems - value.length) : parts.length
    if (room > 0) onChange([...value, ...parts.slice(0, room)])
  }

  return (
    <div
      className={cn(
        'border border-input rounded-sm bg-input-bg flex flex-wrap items-center gap-1.5',
        'focus-within:ring-1 focus-within:ring-ring',
        disabled && 'opacity-60 cursor-not-allowed',
        sizes[size],
        containerClassName,
      )}
      onClick={() => inputRef.current?.focus()}
    >
      {value.map((token, i) => {
        const status = statusOf(token, i)
        return (
          <span
            key={i}
            title={status.error}
            onClick={e => { if (!status.valid) { e.stopPropagation(); reopen(i) } }}
            className={cn(
              'inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-sm text-xs',
              status.valid
                ? 'bg-muted text-foreground'
                : 'bg-destructive/10 text-destructive border border-destructive/30 cursor-pointer hover:bg-destructive/15',
            )}
          >
            {token}
            <button
              type="button"
              tabIndex={-1}
              onClick={e => { e.stopPropagation(); removeAt(i) }}
              className="rounded-xs hover:bg-black/10 dark:hover:bg-white/10 p-0.5"
            >
              <Icons.X className="w-3 h-3" />
            </button>
          </span>
        )
      })}
      <input
        ref={inputRef}
        id={id}
        data-keywatch="none"
        value={text}
        disabled={disabled || atMax}
        onChange={e => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder={value.length === 0 ? placeholder : undefined}
        className={cn(
          'flex-1 min-w-20 bg-transparent border-0 outline-none focus:ring-0 text-sm',
          'disabled:cursor-not-allowed',
          className,
        )}
      />
      {maxItems != null && (
        <span className="text-[10px] text-muted-foreground shrink-0 ml-auto pl-1">{value.length}/{maxItems}</span>
      )}
    </div>
  )
}
