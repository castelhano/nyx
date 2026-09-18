'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { apiPatch } from './api'
import type { RouteLocality } from './types'

interface Props {
  rl:            RouteLocality
  isOrigin:      boolean
  isDestination: boolean
}

// Inline edit surface for a stop's own editable fields, shown inside the point's
// popup/modal (map & régua views alike) — a waypoint (no localityId) has nothing
// here to edit. "Ponto de controle" (includeInOso) is hidden on the origin (marking
// it would duplicate the always-present departure column — see
// oso-layout.resolver.ts's buildColumns) and on the destination (that one's CHEGADA
// toggle lives in CreateRouteModal instead, so a single place owns it).
export function PointEditFields({ rl, isOrigin, isDestination }: Props) {
  const queryClient = useQueryClient()
  const [allowsCrewChange, setAllowsCrewChange] = useState(rl.allowsCrewChange)
  const [includeInOso,     setIncludeInOso]     = useState(rl.includeInOso)
  const [saving, setSaving] = useState(false)

  if (rl.localityId == null) return null

  const showControlPoint = !isOrigin && !isDestination
  const dirty = allowsCrewChange !== rl.allowsCrewChange || (showControlPoint && includeInOso !== rl.includeInOso)

  async function handleSave() {
    setSaving(true)
    try {
      const body: Record<string, unknown> = { allowsCrewChange }
      if (showControlPoint) body.includeInOso = includeInOso
      await apiPatch(`/transit/route-locality/${rl.id}`, body)
      await queryClient.invalidateQueries({ queryKey: ['transit', 'trajectory', rl.routeId] })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="pt-2 mt-2 border-t border-border space-y-1.5">
      <label className="flex items-center gap-2 text-xs cursor-pointer">
        <input
          type="checkbox"
          className="h-3.5 w-3.5 rounded-sm border-input"
          checked={allowsCrewChange}
          onChange={(e) => setAllowsCrewChange(e.target.checked)}
        />
        Troca de motorista
      </label>
      {showControlPoint && (
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 rounded-sm border-input"
            checked={includeInOso}
            onChange={(e) => setIncludeInOso(e.target.checked)}
          />
          Ponto de controle
        </label>
      )}
      <Button type="button" size="sm" onClick={handleSave} disabled={!dirty || saving} className="w-full mt-1">
        {saving ? 'Salvando…' : 'Salvar'}
      </Button>
    </div>
  )
}
