import type { EmployeeChangeOrigin, Prisma } from '@prisma/client'

// The Employee fields whose changes are kept in EmployeeChange
const TRACKED = ['phone'] as const
type Tracked = Partial<Record<typeof TRACKED[number], string | null | undefined>>

// one EmployeeChange per tracked field that differs between before and after
export async function logEmployeeChanges(
  db: Prisma.TransactionClient,
  employeeId: string,
  before: Tracked,
  after: Tracked,
  origin: EmployeeChangeOrigin,
  userId?: string,
): Promise<void> {
  const data = TRACKED
    .filter(f => (before[f] || null) !== (after[f] || null))
    .map(field => ({ employeeId, field, oldValue: before[field] || null, newValue: after[field] || null, origin, userId: userId ?? null }))
  if (data.length) await db.employeeChange.createMany({ data })
}
