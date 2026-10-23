import { BadRequestException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'

// Contract rules shared by the contract CRUD and the employee import (which runs them inside
// its own transaction) — `db` is the Prisma client or the transaction's.
type Db = Prisma.TransactionClient

// Close open contract that predates the new start (startDate < newStart)
export async function closeOpenContract(db: Db, employeeId: string, newStart: Date): Promise<void> {
  const open = await db.contract.findFirst({
    where: { employeeId, endDate: null, startDate: { lt: newStart } },
  })
  if (!open) return

  const closeDate = new Date(newStart)
  closeDate.setDate(closeDate.getDate() - 1)

  const engineNote = '--\nFinalizado automaticamente pelo engine.'
  const notes = open.notes ? `${open.notes}\n${engineNote}` : engineNote

  await db.contract.update({
    where: { id: open.id },
    data:  { endDate: closeDate, status: 'EXPIRED', notes },
  })
}

export async function assertSingleActive(db: Db, employeeId: string, status: string | undefined, excludeId?: string): Promise<void> {
  if (status !== 'ACTIVE') return
  const existing = await db.contract.findFirst({
    where: {
      employeeId,
      status: 'ACTIVE',
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  })
  if (existing) {
    throw new BadRequestException('Já existe um contrato ativo para este funcionário. Finalize-o antes de ativar outro.')
  }
}

// Conflict rules:
// - open contract with startDate >= newStart (can't auto-close, periods overlap)
// - closed contract where existingStart <= newEnd AND existingEnd >= newStart
export async function assertNoConflict(
  db: Db,
  employeeId: string,
  start: Date,
  end: Date | null,
  excludeId?: string,
): Promise<void> {
  const base = excludeId ? { id: { not: excludeId } } : {}

  const conflict = await db.contract.findFirst({
    where: {
      employeeId,
      ...base,
      OR: [
        // open contract that starts AT or AFTER newStart — can't be auto-closed, real overlap
        { endDate: null, startDate: { gte: start } },
        // open contract that starts BEFORE newStart but newEnd exists — overlaps if openStart <= newEnd
        ...(end ? [{ endDate: null, startDate: { lt: start, lte: end } }] : []),
        // closed contract: existingStart <= newEnd AND existingEnd >= newStart
        {
          endDate:   { not: null, gte: start },
          startDate: end ? { lte: end } : undefined,
        },
      ],
    },
  })

  if (conflict) {
    throw new BadRequestException('O período informado conflita com outro contrato existente.')
  }
}
