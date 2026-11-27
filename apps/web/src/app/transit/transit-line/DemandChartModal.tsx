'use client'

import { useState, useEffect } from 'react'
import { createPortal }        from 'react-dom'
import { useQuery }            from '@tanstack/react-query'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'
import { Button } from '@/components/ui/button'
import { cn }     from '@/lib/utils'
import { apiFetch } from '@/lib/auth'

type DirMap  = Record<string, number>              // hour → pax
type DayData = Record<string, DirMap>              // direction → DirMap
export type DemandData = Record<string, DayData>   // dayTypeCode → DayData

const DIR_LABEL: Record<string, string> = {
  OUTBOUND: 'Ida',
  INBOUND:  'Volta',
  CIRCULAR: 'Circular',
}

const DIR_ORDER: Record<string, number> = { OUTBOUND: 0, INBOUND: 1, CIRCULAR: 2 }

const BAR_COLOR = 'hsl(var(--ring))'

interface Props {
  demand:  DemandData
  onClose: () => void
}

const sortDirs = (dirs: string[]) => [...dirs].sort((a, b) => (DIR_ORDER[a] ?? 99) - (DIR_ORDER[b] ?? 99))

export function DemandChartModal({ demand, onClose }: Props) {
  // day types in their registered display order (U, S, D, F, E…); unknown codes last
  const { data: dayTypesPage } = useQuery({
    queryKey: ['transit', 'day-type', 'all'],
    queryFn:  async () => {
      const res = await apiFetch('/transit/day-type?pageSize=100')
      if (!res.ok) throw new Error('Failed to fetch day types')
      return res.json() as Promise<{ data: Array<{ code: string; sortOrder: number }> }>
    },
  })
  const sortOrder = new Map((dayTypesPage?.data ?? []).map(dt => [dt.code, dt.sortOrder]))
  const dayCodes  = Object.keys(demand).sort((a, b) => (sortOrder.get(a) ?? 999) - (sortOrder.get(b) ?? 999))

  // null until the user picks one: the first in order, which may only settle once
  // the day types load
  const [pickedDay, setActiveDay] = useState<string | null>(null)
  const [pickedDir, setActiveDir] = useState<string | null>(null)

  const activeDay = pickedDay ?? dayCodes[0] ?? ''
  const dirs      = activeDay ? sortDirs(Object.keys(demand[activeDay] ?? {})) : []
  const activeDir = pickedDir && dirs.includes(pickedDir) ? pickedDir : dirs[0] ?? ''

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const rawData = (activeDay && activeDir) ? demand[activeDay][activeDir] : {}

  const chartData = Object.entries(rawData)
    .map(([h, pax]) => ({ hour: `${h}h`, pax, _h: Number(h) }))
    .sort((a, b) => a._h - b._h)
    .map(({ hour, pax }) => ({ hour, pax }))


  function downloadCsv(dayCode: string) {
    const dayData  = demand[dayCode] ?? {}
    const allDirs  = sortDirs(Object.keys(dayData))
    const allHours = [...new Set(allDirs.flatMap((d) => Object.keys(dayData[d]).map(Number)))]
      .sort((a, b) => a - b)

    const header = ['hora', ...allDirs.map((d) => DIR_LABEL[d] ?? d)].join(';')
    const rows   = allHours.map((h) =>
      [h, ...allDirs.map((d) => dayData[d][String(h)] ?? 0)].join(';'),
    )
    const csv  = [header, ...rows].join('\n')
    const BOM  = '﻿'
    const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = Object.assign(document.createElement('a'), {
      href:     url,
      download: `demanda_${dayCode}.csv`,
    })
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="relative z-10 w-full max-w-3xl mx-4 bg-card border border-border rounded-lg shadow-xl flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="text-base font-semibold">Demanda por Faixa Horária</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Passageiros médios por hora</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Day type selector */}
        <div className="px-5 py-3 border-b border-border flex flex-wrap items-center gap-2">
          {dayCodes.map((code) => (
            <div key={code} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setActiveDay(code)}
                className={cn(
                  'px-3 py-1 rounded-full text-xs font-medium transition-colors',
                  code === activeDay
                    ? 'bg-ring text-white'
                    : 'bg-muted text-muted-foreground hover:text-foreground',
                )}
              >
                {code}
              </button>
              <button
                type="button"
                title={`Baixar CSV — ${code}`}
                onClick={() => downloadCsv(code)}
                className="px-2 py-1 rounded text-xs font-medium bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
              >
                CSV
              </button>
            </div>
          ))}

          {dirs.length > 1 && (
            <div className="ml-auto flex gap-1">
              {dirs.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setActiveDir(d)}
                  className={cn(
                    'px-3 py-1 rounded-full text-xs font-medium transition-colors',
                    d === activeDir
                      ? 'bg-ring text-white'
                      : 'bg-muted text-muted-foreground hover:text-foreground',
                  )}
                >
                  {DIR_LABEL[d] ?? d}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Chart */}
        <div className="p-4" style={{ height: 320 }}>
          {chartData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              {activeDir ? 'Sem dados para este tipo de dia' : 'Carregando…'}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="hour"
                  tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                  axisLine={false}
                  tickLine={false}
                  width={40}
                />
                <Tooltip
                  contentStyle={{
                    background:   'hsl(var(--card))',
                    border:       '1px solid hsl(var(--border))',
                    borderRadius: '6px',
                    fontSize:     12,
                  }}
                  formatter={(v) => [`${Number(v).toLocaleString('pt-BR')} pax`, activeDir ? (DIR_LABEL[activeDir] ?? activeDir) : '']}
                />
                <Bar dataKey="pax" fill={BAR_COLOR} maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end px-5 py-4 border-t border-border">
          <Button variant="cancel" size="sm" onClick={onClose}>Fechar</Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
