'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Icons } from '@/lib/icons'
import { apiFetch } from '@/lib/auth'
import { extractError } from '@/lib/utils'
import { useToast } from '@/lib/toast-context'
import { useShortcutContext } from '@/lib/keywatch'
import { cn } from '@/lib/utils'

interface OsoLine {
  id:       string
  code:     string
  name:     string
  hasTrips: boolean
}

interface LineGroup {
  id:      string
  name:    string
  lineIds: string[]
}

interface Props {
  planId:  string
  onClose: () => void
}

export function ExportOsoModal({ planId, onClose }: Props) {
  useShortcutContext('export_oso_md')
  const { toast } = useToast()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [format, setFormat] = useState<'xlsx' | 'pdf'>('pdf')
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const { data: lines = [], isLoading } = useQuery<OsoLine[]>({
    queryKey: ['transit', 'vehicle-plan', planId, 'oso', 'lines'],
    queryFn:  async () => {
      const res = await apiFetch(`/transit/vehicle-plan/${planId}/oso/lines`)
      if (!res.ok) throw new Error('Falha ao carregar linhas')
      return res.json()
    },
  })

  const { data: groups = [] } = useQuery<LineGroup[]>({
    queryKey: ['transit', 'line-group', 'all'],
    queryFn:  async () => {
      const res = await apiFetch('/transit/line-group?pageSize=999')
      if (!res.ok) return []
      const json = await res.json()
      return json.data ?? json
    },
  })

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function applyGroup(lineIds: string[]) {
    const exportable = new Set(lines.filter(l => l.hasTrips).map(l => l.id))
    setSelected(new Set(lineIds.filter(id => exportable.has(id))))
  }

  async function handleExport() {
    if (selected.size === 0) return
    setExporting(true)
    try {
      const res = await apiFetch(`/transit/vehicle-plan/${planId}/oso/export`, {
        method: 'POST',
        body:   JSON.stringify({ lineIds: [...selected], format }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(extractError(json))
      }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = Object.assign(document.createElement('a'), { href: url, download: `oso.${format}` })
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao exportar OSO')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 bg-card border border-border rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold">Exportar OSO</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground">
            <Icons.X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              Selecionar:
              <button onClick={() => setSelected(new Set(lines.filter(l => l.hasTrips).map(l => l.id)))} className="hover:text-foreground underline">
                Todos
              </button>
              <span>·</span>
              <button onClick={() => setSelected(new Set())} className="hover:text-foreground underline">
                Nenhum
              </button>
            </div>
            <span>{selected.size} selecionada{selected.size === 1 ? '' : 's'}</span>
          </div>

          {groups.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              {groups.map(g => (
                <button key={g.id} onClick={() => applyGroup(g.lineIds)} className="text-xs rounded-full border border-border px-2 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                  {g.name}
                </button>
              ))}
            </div>
          )}

          {isLoading ? (
            <div className="text-sm text-muted-foreground py-6 text-center">Carregando…</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {lines.map(l => {
                const isSelected = selected.has(l.id)
                return (
                  <button
                    key={l.id}
                    type="button"
                    disabled={!l.hasTrips}
                    onClick={() => toggle(l.id)}
                    title={l.hasTrips ? l.name : `${l.name} — sem viagens neste plano`}
                    className={cn(
                      'px-3 py-1 rounded-sm border text-sm transition-colors cursor-pointer',
                      isSelected
                        ? 'bg-accent text-accent-foreground border-accent'
                        : 'bg-background text-muted-foreground hover:bg-muted',
                      !l.hasTrips && 'opacity-40 cursor-not-allowed hover:bg-background',
                    )}
                  >
                    {l.code}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-border">
          <div className="flex items-center rounded-sm border border-border overflow-hidden text-sm">
            {(['xlsx', 'pdf'] as const).map(f => (
              <button
                key={f}
                type="button"
                onClick={() => setFormat(f)}
                className={cn(
                  'px-3 py-1 uppercase',
                  format === f
                    ? 'bg-accent text-accent-foreground'
                    : 'bg-background text-muted-foreground hover:bg-muted',
                )}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button onClick={handleExport} disabled={selected.size === 0 || exporting}>
              {exporting ? 'Gerando…' : 'Exportar'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
