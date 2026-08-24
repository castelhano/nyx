'use client'

import { useState } from 'react'
import { MultiSelect } from '@/components/ui/multi-select'

const DAY_TYPE_OPTIONS = [
  { id: 'U', label: 'Dia útil' },
  { id: 'S', label: 'Sábado' },
  { id: 'D', label: 'Domingo' },
  { id: 'E', label: 'Especial' },
  { id: 'F', label: 'Férias' },
]

export default function PlaygroundPage() {
  const [dayTypes, setDayTypes] = useState<string[]>(['U', 'S'])

  return (
    <div className="max-w-sm mx-auto mt-20 space-y-2">
      <span className="text-sm text-muted-foreground">Tipos de dia</span>
      <MultiSelect
        value={dayTypes}
        options={DAY_TYPE_OPTIONS}
        onChange={setDayTypes}
        placeholder="Selecionar tipos de dia…"
      />
    </div>
  )
}
