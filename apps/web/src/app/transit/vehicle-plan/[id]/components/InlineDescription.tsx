'use client'

import { useState, useRef } from 'react'
import { Icons }    from '@/lib/icons'
import { useToast } from '@/lib/toast-context'

export function InlineDescription({
  value,
  disabled,
  onSave,
}: {
  value?:   string
  disabled?: boolean
  onSave:   (val: string) => Promise<void>
}) {
  const { toast }            = useToast()
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState('')
  const inputRef              = useRef<HTMLInputElement>(null)

  function startEdit() {
    if (disabled) return
    setDraft(value ?? '')
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  async function commit() {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed === (value ?? '').trim()) return
    try {
      await onSave(trimmed)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar descrição')
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); inputRef.current?.blur() }
          if (e.key === 'Escape') { setEditing(false) }
        }}
        className="text-sm border-b border-border bg-transparent focus:outline-none focus:border-ring min-w-32 max-w-64"
      />
    )
  }

  return (
    <span>
      <Icons.Option className="inline w-4 h-4 me-1 text-cyan-700" />
      <span
      onDoubleClick={startEdit}
      title={disabled ? undefined : 'Duplo clique para editar'}
      className={disabled ? undefined : 'cursor-text'}
      >
      {value
        ? <span className="text-foreground  uppercase">{value}</span>
        : <span className="italic text-muted-foreground/60">Descrição</span>
      }
      </span>
    </span>
  )
}
