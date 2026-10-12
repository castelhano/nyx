import type { PrismaService } from '../../../../prisma/prisma.service'

// The system absence types (created by the migration, never deleted): the type a roster day off
// gets when none is chosen.
const ids = new Map<string, string>()

export const systemKeyOf = (kind: 'DAY_OFF' | 'COMP_OFF') => (kind === 'DAY_OFF' ? 'WEEKLY_OFF' : 'COMP_OFF')

export async function systemAbsenceTypeId(prisma: PrismaService, kind: 'DAY_OFF' | 'COMP_OFF'): Promise<string | null> {
  const key = systemKeyOf(kind)
  if (ids.has(key)) return ids.get(key)!
  const t = await prisma.crewAbsenceType.findUnique({ where: { systemKey: key }, select: { id: true } })
  if (t) ids.set(key, t.id)
  return t?.id ?? null
}

// the férias type (systemKey VACATION) — the only absence that names a ferista
export async function vacationTypeId(prisma: PrismaService): Promise<string | null> {
  if (ids.has('VACATION')) return ids.get('VACATION')!
  const t = await prisma.crewAbsenceType.findUnique({ where: { systemKey: 'VACATION' }, select: { id: true } })
  if (t) ids.set('VACATION', t.id)
  return t?.id ?? null
}
