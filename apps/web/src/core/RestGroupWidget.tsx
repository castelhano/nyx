'use client'

import { useQuery } from '@tanstack/react-query'
import { Controller, useWatch, type Control } from 'react-hook-form'
import { nextRestDay, restGroupLabel, restGroupOffsets } from '@nyx/schemas'
import type { MetadataField } from '@nyx/types'
import { Select } from '@/components/ui/select'
import { apiFetch } from '@/lib/auth'
import { localToday } from '@/lib/plan-vigence'

// widget 'rest-group' — CrewMember.restOffset as a group of the crew member's rest pattern
// (his own, or his current shift's), each option with its next day off.

const WEEKDAY = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

interface Pattern { name: string; pattern: string; anchorDate: string; offOnHolidays: boolean; staggered: boolean }

async function get<T>(path: string): Promise<T | null> {
  const res = await apiFetch(path)
  return res.ok ? res.json() : null
}

export function RestGroupWidget({ field, control, readonly }: { field: MetadataField; control: Control<any>; readonly?: boolean }) {
  const restPatternId = useWatch({ control, name: 'restPatternId' }) as string | null | undefined
  const shiftId       = useWatch({ control, name: 'shiftId' }) as string | null | undefined

  const { data: pattern, isLoading } = useQuery<Pattern | null>({
    queryKey: ['transit', 'rest-group', restPatternId ?? null, shiftId ?? null],
    queryFn:  async () => {
      let id = restPatternId
      if (!id && shiftId) id = (await get<{ restPatternId: string | null }>(`/transit/crew-shift/${shiftId}`))?.restPatternId ?? null
      return id ? get<Pattern>(`/transit/rest-pattern/${id}`) : null
    },
  })

  const fmt = (day: string | null) => {
    if (!day) return ''
    const d = new Date(`${day}T00:00:00Z`)
    return ` — próxima folga ${WEEKDAY[d.getUTCDay()]} ${day.slice(8, 10)}/${day.slice(5, 7)}`
  }

  return (
    <>
      <label htmlFor={field.name} className="text-sm font-medium pt-2">{field.label}</label>
      <div className="space-y-1">
        <Controller
          name={field.name}
          control={control}
          render={({ field: ctrl }) => {
            const value = Number(ctrl.value ?? 0)
            const offsets = pattern ? restGroupOffsets(pattern) : []
            const today = localToday()
            return (
              <Select
                id={field.name}
                value={String(value)}
                onChange={(e) => ctrl.onChange(Number(e.target.value))}
                disabled={readonly || !pattern}
                wrapperClassName={field.className}
              >
                {!pattern && <option value={String(value)}>{isLoading ? 'Carregando…' : 'Sem regime de folga (nem no turno)'}</option>}
                {pattern && offsets.map((o, g) => (
                  <option key={o} value={String(o)}>Grupo {restGroupLabel(g)}{fmt(nextRestDay(pattern, o, today))}</option>
                ))}
                {pattern && !offsets.includes(value % pattern.pattern.length) && (
                  <option value={String(value)}>Fora de grupo (deslocado {value} dia(s))</option>
                )}
              </Select>
            )
          }}
        />
        {pattern && <p className="text-xs text-muted-foreground">Regime {pattern.name}{restPatternId ? '' : ' (do turno)'} — grupos revezam as folgas.</p>}
      </div>
    </>
  )
}
