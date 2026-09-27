import type { BadgeColor } from '@/components/ui/badge'

// Badge of a versioned plan (VehiclePlan, CrewPlan, LineSchedule) from its status and vigência:
// the ACTIVE one may still start in the future and a
// SUPERSEDED one may still be running until its end. Validity comes as @db.Date ISO strings.

export function localToday(): string {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

const day   = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : null)
const ddmm  = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`

export function vigenceBadge(
  status: string | null | undefined,
  validFrom: string | null | undefined,
  validTo: string | null | undefined,
  activeLabel = 'ATIVO',
): { label: string; color: BadgeColor } {
  const today = localToday()
  const from = day(validFrom), to = day(validTo)
  if (status === 'ACTIVE' || status === 'APPROVED') {
    return from && from > today ? { label: `${activeLabel} • ${ddmm(from)}`, color: 'info' } : { label: activeLabel, color: 'success' }
  }
  if (status === 'SUPERSEDED') {
    return to && to >= today ? { label: `ATÉ ${ddmm(to)}`, color: 'warning' } : { label: 'SUBSTITUÍDO', color: 'muted' }
  }
  return { label: 'RASCUNHO', color: 'muted' }
}
