'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { VehiclePlanGanttData } from '../views/vehicles.view'
import { LineSummaryView } from './LineSummaryView'
import { PlanSummaryView } from './PlanSummaryView'

interface Props {
  planId:  string
  // lines selected when the summary was opened — none means only the plan view is available
  lineIds: string[]
  lines:   { lineId: string; code: string; name: string }[]
  onClose: () => void
  mergedPlottedData?: VehiclePlanGanttData | null
  hasPendingChanges?: boolean
}

// The "Resumo" panel: the whole plan or the selected lines, switched in its status bar.
// Opens on the lines when any were selected, on the plan otherwise.
export function SummaryView({ planId, lineIds, lines, onClose, mergedPlottedData, hasPendingChanges }: Props) {
  const [mode, setMode] = useState<'plan' | 'lines'>(lineIds.length > 0 ? 'lines' : 'plan')

  const switcher = (
    <div className="flex items-center rounded-md border border-border p-0.5 mr-1">
      {([
        { key: 'plan',  label: 'Plano',  disabled: false },
        { key: 'lines', label: 'Linhas', disabled: lineIds.length === 0 },
      ] as const).map(o => (
        <button
          key={o.key}
          type="button"
          onClick={() => setMode(o.key)}
          disabled={o.disabled}
          title={o.disabled ? 'Selecione ao menos uma linha em "Linhas"' : undefined}
          className={cn(
            'px-3 py-1 text-xs font-medium rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
            mode === o.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )

  return mode === 'plan' ? (
    <PlanSummaryView planId={planId} onClose={onClose} switcher={switcher} hasPendingChanges={hasPendingChanges} />
  ) : (
    <LineSummaryView
      planId={planId}
      lineIds={lineIds}
      lines={lines}
      onClose={onClose}
      switcher={switcher}
      mergedPlottedData={mergedPlottedData}
      hasPendingChanges={hasPendingChanges}
    />
  )
}
