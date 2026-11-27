'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Icons } from '@/lib/icons'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'

interface Line {
  id:    string
  code:  string
  name?: string
}

const lineLabel = (l: Line) => l.name ? `${l.code} — ${l.name}` : l.code

// CSV lines with no system line of the same code: each one starts on the closest guess and
// can point to any other line, or be cleared to skip it in this review.
export function LineMatchModal<T extends Line>({ unmatched, rawCodes, systemLines, onApply, onClose }: {
  unmatched:   Map<string, T | null>
  rawCodes:    Map<string, string>
  systemLines: T[]
  onApply:     (choices: Map<string, T | null>) => void
  onClose:     () => void
}) {
  const [choices, setChoices] = useState(() => new Map(unmatched))
  const [search,  setSearch]  = useState<Record<string, string>>({})

  const byId = new Map(systemLines.map(l => [l.id, l]))

  const optionsFor = (code: string) => {
    const q = (search[code] ?? '').trim().toLowerCase()
    return systemLines
      .filter(l => !q || lineLabel(l).toLowerCase().includes(q))
      .slice(0, 50)
      .map(l => ({ id: l.id, label: l.code, secondary: l.name }))
  }

  const skipped = [...choices.values()].filter(v => !v).length

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative bg-background border border-border rounded-lg shadow-xl w-full max-w-lg flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="font-semibold text-base">Linhas sem correspondência</h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <Icons.X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3 overflow-y-auto min-h-72">
          <p className="text-xs text-muted-foreground">
            Estas linhas do CSV não foram encontradas no sistema. Confirme a sugestão, escolha outra linha ou limpe o campo para ignorá-la nesta revisão.
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="text-left font-medium pb-1 w-24">CSV</th>
                <th className="text-left font-medium pb-1">Linha no sistema</th>
              </tr>
            </thead>
            <tbody>
              {[...choices].map(([code, rec]) => (
                <tr key={code}>
                  <td className="py-1 font-mono">{rawCodes.get(code) ?? code}</td>
                  <td className="py-1">
                    <Combobox
                      value={rec?.id ?? null}
                      displayValue={rec ? lineLabel(rec) : ''}
                      search={search[code] ?? ''}
                      onSearchChange={v => setSearch(s => ({ ...s, [code]: v }))}
                      options={optionsFor(code)}
                      onSelect={o => {
                        setSearch(s => ({ ...s, [code]: '' }))
                        setChoices(c => new Map(c).set(code, o ? byId.get(o.id) ?? null : null))
                      }}
                      placeholder="Ignorar"
                      emptyMessage="Nenhuma linha"
                      className="h-8 w-full text-sm border border-input rounded-sm bg-input-bg focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-border shrink-0">
          <span className="text-xs text-muted-foreground">
            {skipped > 0 && `${skipped} ignorada${skipped !== 1 ? 's' : ''}`}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Depois</Button>
            <Button onClick={() => onApply(choices)}>Aplicar</Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
