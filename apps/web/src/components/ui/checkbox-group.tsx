'use client'

import { useState, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { resolveIcon } from '@/lib/icons'

const ACTIONS = [
  { key: 'read',   label: 'Ver' },
  { key: 'create', label: 'Criar' },
  { key: 'update', label: 'Editar' },
  { key: 'delete', label: 'Excluir' },
] as const

export interface CheckboxSection {
  key:       string
  label:     string
  resources: { key: string; label: string }[]
}

interface Props {
  sections: CheckboxSection[]
  value:    Set<string>
  onChange: (value: Set<string>) => void
}

const inputBase = 'w-full border border-input rounded-sm px-3 py-2 text-sm bg-input-bg focus:outline-none focus:ring-1 focus:ring-ring'

export function CheckboxGroup({ sections, value, onChange }: Props) {
  const [filter, setFilter] = useState('')

  const filtered = useMemo(() => {
    if (!filter) return sections
    const q = filter.toLowerCase()
    return sections
      .map((s) => ({
        ...s,
        resources: s.resources.filter(
          (r) => r.label.toLowerCase().includes(q) || r.key.toLowerCase().includes(q),
        ),
      }))
      .filter((s) => s.resources.length > 0)
  }, [sections, filter])

  function toggle(resource: string, action: string) {
    const k    = `${resource}:${action}`
    const next = new Set(value)
    if (next.has(k)) next.delete(k)
    else             next.add(k)
    onChange(next)
  }

  function toggleResource(resource: string) {
    const all   = ACTIONS.map((a) => `${resource}:${a.key}`)
    const allOn = all.every((k) => value.has(k))
    const next  = new Set(value)
    if (allOn) all.forEach((k) => next.delete(k))
    else       all.forEach((k) => next.add(k))
    onChange(next)
  }

  function toggleSection(section: CheckboxSection) {
    const all   = section.resources.flatMap((r) => ACTIONS.map((a) => `${r.key}:${a.key}`))
    const allOn = all.every((k) => value.has(k))
    const next  = new Set(value)
    if (allOn) all.forEach((k) => next.delete(k))
    else       all.forEach((k) => next.add(k))
    onChange(next)
  }

  return (
    <div className="space-y-4">
      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filtrar recursos…"
        className={inputBase}
      />

      {filtered.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhum recurso encontrado.</p>
      )}

      {filtered.map((section) => {
        const sectionKeys = section.resources.flatMap((r) =>
          ACTIONS.map((a) => `${r.key}:${a.key}`),
        )
        const allChecked = sectionKeys.length > 0 && sectionKeys.every((k) => value.has(k))

        return (
          <div key={section.key} className="border border-border rounded-sm overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 bg-muted/40 border-b border-border">
              <span className="text-sm font-medium">{section.label}</span>
              <button
                type="button"
                onClick={() => toggleSection(section)}
                className="text-xs text-muted-foreground hover:text-ring transition-colors cursor-pointer"
              >
                {allChecked ? 'Desmarcar todos' : 'Marcar todos'}
              </button>
            </div>

            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-muted/20 border-b border-border">
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                    Recurso
                  </th>
                  {ACTIONS.map((a) => (
                    <th
                      key={a.key}
                      className="w-16 py-2 text-center text-xs font-medium text-muted-foreground"
                    >
                      {a.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {section.resources.map((resource, i) => (
                  <tr
                    key={resource.key}
                    className={cn(
                      'hover:bg-row-hover transition-colors',
                      i < section.resources.length - 1 && 'border-b border-border',
                    )}
                  >
                    <td className="px-3 py-2.5">
                      <span className="flex items-center justify-between group/row">
                        {resource.label}
                        {(() => {
                          const allOn = ACTIONS.every((a) => value.has(`${resource.key}:${a.key}`))
                          const Icon  = resolveIcon('ArrowRightFromLine')
                          return (
                            <button
                              type="button"
                              onClick={() => toggleResource(resource.key)}
                              className={cn(
                                'h-7 px-2 -mt-2 -mb-2 cursor-pointer',
                                'text-muted hover:bg-input hover:text-accent-foreground rounded transition-colors',
                              )}
                            >
                              <Icon className="h-4 w-4" />
                            </button>
                          )
                        })()}
                      </span>
                    </td>
                    {ACTIONS.map((action) => (
                      <td key={action.key} className="w-16 py-2.5 text-center">
                        <input
                          type="checkbox"
                          checked={value.has(`${resource.key}:${action.key}`)}
                          onChange={() => toggle(resource.key, action.key)}
                          className="rounded"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}
