'use client'

import { useState }  from 'react'
import { Button }    from '@/components/ui/button'
import type { SuggestedLocality } from './types'

interface Props {
  suggestions: SuggestedLocality[]
  onConfirm:  (selected: SuggestedLocality[]) => void
  onClose:    () => void
}

export function SuggestModal({ suggestions, onConfirm, onClose }: Props) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set(suggestions.map((s) => s.id)))

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function handleConfirm() {
    onConfirm(suggestions.filter((s) => checked.has(s.id)))
  }

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40">
      <div className="bg-background border border-border rounded-md shadow-lg w-full max-w-lg p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Pontos sugeridos no trajeto</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Desmarque os pontos que não devem ser adicionados.
          </p>
        </div>

        {suggestions.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            Nenhum ponto encontrado próximo ao trajeto.
          </p>
        ) : (
          <div className="max-h-80 overflow-y-auto space-y-1 pr-1">
            {suggestions.map((s) => (
              <label
                key={s.id}
                className="flex items-center gap-3 px-3 py-2 rounded-sm hover:bg-muted cursor-pointer"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-accent"
                  checked={checked.has(s.id)}
                  onChange={() => toggle(s.id)}
                />
                <span className="flex-1 text-sm">{s.name}</span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {s.distanceM}m · após seq {s.insertAfterSequence}
                </span>
              </label>
            ))}
          </div>
        )}

        <div className="flex justify-between items-center pt-2">
          <span className="text-xs text-muted-foreground">{checked.size} selecionado{checked.size !== 1 ? 's' : ''}</span>
          <div className="flex gap-2">
            <Button type="button" variant="cancel" onClick={onClose}>Cancelar</Button>
            <Button type="button" onClick={handleConfirm} disabled={checked.size === 0}>
              Adicionar selecionados
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
