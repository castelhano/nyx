import { BadRequestException } from '@nestjs/common'

// Vigência of VehiclePlan, CrewPlan and LineSchedule (docs/proposal/plan_activation_date_v1.md).
// validFrom/validTo are @db.Date (end inclusive) — Prisma hands them over as UTC midnights,
// so days are compared as 'YYYY-MM-DD' strings. "What runs on a day" always comes from the
// window of the non-DRAFT versions (inForceOn), never from the status alone: the ACTIVE one is
// just the latest activated and may start in the future.

export type Day = string

export interface Window { validFrom: Date | null; validTo: Date | null }
export interface VersionRow extends Window { id: string; label: string }

export interface ActivationEffect {
  // in force before the start: end cut to the day before
  superseded: { id: string; label: string; validTo: Day }[]
  // would only start on/after the start date — never was in force: back to DRAFT
  reverted:   { id: string; label: string }[]
}

export const dayOf    = (d: Date): Day => d.toISOString().slice(0, 10)
export const toDbDate = (day: Day): Date => new Date(`${day}T00:00:00.000Z`)

export function addDays(day: Day, n: number): Day {
  const d = toDbDate(day)
  d.setUTCDate(d.getUTCDate() + n)
  return dayOf(d)
}

// today on the server's local calendar (the operation's time zone)
export function localToday(): Day {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

export function parseStartDate(s: unknown): Day {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s) || dayOf(toDbDate(s)) !== s) {
    throw new BadRequestException('Data de início inválida')
  }
  return s
}

export function inForceOn(p: Window, day: Day): boolean {
  return (!p.validFrom || dayOf(p.validFrom) <= day) && (!p.validTo || dayOf(p.validTo) >= day)
}

// Rule 3: activating from `start`, every other version reaching `start` or later is cut to
// the day before, or reverted when it would only begin on/after `start`.
export function activationEffect(others: VersionRow[], start: Day): ActivationEffect {
  const cut = addDays(start, -1)
  const effect: ActivationEffect = { superseded: [], reverted: [] }
  for (const p of others) {
    if (p.validTo && dayOf(p.validTo) < start) continue
    if (p.validFrom && dayOf(p.validFrom) >= start) effect.reverted.push({ id: p.id, label: p.label })
    else effect.superseded.push({ id: p.id, label: p.label, validTo: cut })
  }
  return effect
}

// Rule 4: a start in the past is only accepted when no other version is in force (or
// scheduled) on that day or later — it only fills a gap, never rewrites what ran.
export function assertRetroactiveAllowed(others: VersionRow[], start: Day): void {
  if (start >= localToday()) return
  const conflict = others.find(p => !p.validTo || dayOf(p.validTo) >= start)
  if (!conflict) return
  const from = conflict.validFrom ? dayOf(conflict.validFrom) : null
  const to   = conflict.validTo ? dayOf(conflict.validTo) : null
  const window = from && to ? `de ${fmtDay(from)} a ${fmtDay(to)}` : from ? `desde ${fmtDay(from)}` : to ? `até ${fmtDay(to)}` : 'sem data'
  throw new BadRequestException(`Data retroativa conflita com "${conflict.label}" (vigente ${window})`)
}

// Writes an ActivationEffect on the model's delegate (vehiclePlan, crewPlan, lineSchedule —
// all use SUPERSEDED/DRAFT and the same validity columns).
export async function applyEffect(
  delegate: { update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown> },
  effect: ActivationEffect,
): Promise<void> {
  for (const s of effect.superseded) {
    await delegate.update({ where: { id: s.id }, data: { status: 'SUPERSEDED', validTo: toDbDate(s.validTo) } })
  }
  for (const r of effect.reverted) {
    await delegate.update({ where: { id: r.id }, data: { status: 'DRAFT', validFrom: null, validTo: null } })
  }
}

export function fmtDay(day: Day): string {
  const [y, m, d] = day.split('-')
  return `${d}/${m}/${y}`
}
