'use client'

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/auth'
import type { ServiceRequirementLike } from '@nyx/schemas'

export interface ServiceRequirementRecord extends ServiceRequirementLike {
  label:    string
  locality: { id: string; name: string } | null
}

// Every Marco (LineServiceRequirement) of a day type, all lines — callers filter by line.
// Shared by the vehicle plan (coverage, generator) and the OSO screen.
export function useLineServiceRequirements(dayTypeId: string | null | undefined) {
  return useQuery<ServiceRequirementRecord[]>({
    queryKey: ['transit', 'line-service-requirement', 'by-day-type', dayTypeId],
    queryFn:  async () => {
      const res = await apiFetch(`/transit/line-service-requirement?dayTypeId=${dayTypeId}&pageSize=999`)
      if (!res.ok) return []
      return (await res.json()).data ?? []
    },
    enabled:   !!dayTypeId,
    staleTime: 30_000,
  })
}
