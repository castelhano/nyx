import { DAILY_ISSUE_LABEL, DUTY_ISSUE_LABEL, VEHICLE_BLOCK_ISSUE_LABEL } from '@nyx/schemas'
import type { RosterBoard, RosterBoardCell, RosterBoardDuty, RosterBoardMember } from '@nyx/schemas'
import { apiFetch } from '@/lib/auth'
import { extractError } from '@/lib/utils'

// Shared helpers of the "Escala" screen (GET /transit/roster-board and the edits).

export type { RosterBoard, RosterBoardCell, RosterBoardDuty, RosterBoardMember }

export type Mode = 'dia' | 'semana' | 'mes'
export type View = 'operadores' | 'escalas'

export const ISSUE_LABEL: Record<string, string> = { ...VEHICLE_BLOCK_ISSUE_LABEL, ...DUTY_ISSUE_LABEL, ...DAILY_ISSUE_LABEL }

export const WEEKDAY = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
export const weekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay()
export const fmtDay  = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
export const hm      = (m: number) => `${m < 0 ? '-' : ''}${Math.floor(Math.abs(m) / 60)}:${String(Math.abs(m) % 60).padStart(2, '0')}`
export const clock   = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

// the period of a mode around a date: the day, its Monday-to-Sunday week, its month
export function periodOf(mode: Mode, date: string): { from: string; to: string } {
  if (mode === 'dia') return { from: date, to: date }
  if (mode === 'semana') {
    const from = addDays(date, -((weekday(date) + 6) % 7))
    return { from, to: addDays(from, 6) }
  }
  const from = `${date.slice(0, 7)}-01`
  const next = new Date(`${from}T00:00:00Z`)
  next.setUTCMonth(next.getUTCMonth() + 1)
  return { from, to: addDays(next.toISOString().slice(0, 10), -1) }
}

export function shiftPeriod(mode: Mode, date: string, n: number): string {
  if (mode === 'dia') return addDays(date, n)
  if (mode === 'semana') return addDays(date, 7 * n)
  const d = new Date(`${date.slice(0, 7)}-01T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + n)
  return d.toISOString().slice(0, 10)
}

export const dutyName = (d: Pick<RosterBoardDuty, 'number' | 'scope'>, multiScope: boolean) =>
  `${multiScope ? `${d.scope.slice(0, 3)} ` : ''}T${String(d.number).padStart(2, '0')}`

export async function call(path: string, method: 'POST' | 'PUT' | 'PATCH', body: unknown): Promise<void> {
  const res = await apiFetch(path, { method, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(extractError(await res.json().catch(() => ({}))))
}

// indexes the board once per load
export function indexBoard(board: RosterBoard) {
  const dutyById = new Map(board.duties.map(d => [d.id, d]))
  const cellOf = new Map<string, RosterBoardCell>()
  for (const c of board.cells) cellOf.set(`${c.crewMemberId}|${c.date}`, c)
  const memberById = new Map(board.members.map(m => [m.id, m]))
  const shiftCode = new Map(board.shifts.map(s => [s.id, s.code]))
  const offTypeById = new Map(board.offTypes.map(t => [t.id, t]))
  return { dutyById, cellOf, memberById, shiftCode, offTypeById }
}
export type BoardIndex = ReturnType<typeof indexBoard>

// what a crew member has on a date, in one word
export function cellSummary(cell: RosterBoardCell | undefined, idx: BoardIndex, multiScope: boolean) {
  const duties = (cell?.entries ?? []).filter(e => e.dailyDutyId).map(e => idx.dutyById.get(e.dailyDutyId!)).filter((d): d is RosterBoardDuty => !!d)
  const offEntry = cell?.entries.find(e => !e.dailyDutyId)
  const off = offEntry?.kind as 'DAY_OFF' | 'COMP_OFF' | undefined
  const offType = offEntry?.absenceTypeId ? idx.offTypeById.get(offEntry.absenceTypeId) : undefined
  const absence = cell?.requests.find(r => r.kind === 'ABSENCE' && r.status === 'APPROVED')
  return {
    duties,
    // a duty held elsewhere (another empresa's / role's duty on the date)
    elsewhere: (cell?.entries ?? []).some(e => e.dailyDutyId && !idx.dutyById.has(e.dailyDutyId)),
    off, absence,
    // F / FC for the system types, else the type's code
    offLabel: !off ? '' : offType && !offType.system ? offType.code : off === 'COMP_OFF' ? 'FC' : 'F',
    offName:  !off ? '' : offType?.name ?? (off === 'COMP_OFF' ? 'Folga compensada' : 'Folga semanal'),
    offTypeId: offEntry?.absenceTypeId ?? null,
    pending:    (cell?.requests ?? []).filter(r => r.status === 'REQUESTED'),
    window:     cell?.requests.find(r => r.kind === 'TIME_WINDOW' && r.status === 'APPROVED'),
    patternOff: !!cell?.patternOff,
    holiday:    !!cell?.holiday,
    locked:     (cell?.entries ?? []).some(e => e.locked),
    issues:     duties.some(d => d.issues.length > 0),
    label:      duties.length ? duties.map(d => dutyName(d, multiScope)).join('+') : '',
  }
}

// ── instant updates: the board as the edit leaves it, until the server's answer arrives ──

type Entry = RosterBoardCell['entries'][number]

function withCell(board: RosterBoard, memberId: string, date: string, fn: (entries: Entry[]) => Entry[]): RosterBoard {
  let found = false
  const cells = board.cells.map(c => {
    if (c.crewMemberId !== memberId || c.date !== date) return c
    found = true
    return { ...c, entries: fn(c.entries) }
  })
  if (!found) cells.push({ crewMemberId: memberId, date, patternOff: false, holiday: false, entries: fn([]), requests: [] })
  return { ...board, cells }
}

export function withAssign(board: RosterBoard, dutyId: string, memberId: string | null): RosterBoard {
  const duty = board.duties.find(d => d.id === dutyId)
  if (!duty) return board
  let next: RosterBoard = { ...board, duties: board.duties.map(d => (d.id === dutyId ? { ...d, crewMemberId: memberId, locked: false } : d)) }
  if (duty.crewMemberId) next = withCell(next, duty.crewMemberId, duty.date, es => es.filter(e => e.dailyDutyId !== dutyId))
  if (memberId) next = withCell(next, memberId, duty.date, es => [...es, { kind: duty.kind === 'STANDBY' ? 'STANDBY' : 'DUTY', dailyDutyId: dutyId, locked: false, absenceTypeId: null }])
  return next
}

export function withDayOff(board: RosterBoard, items: { memberId: string; date: string }[], kind: 'DAY_OFF' | 'COMP_OFF' | null, absenceTypeId: string | null = null): RosterBoard {
  return items.reduce((b, i) => withCell(b, i.memberId, i.date, es => [...es.filter(e => e.dailyDutyId), ...(kind ? [{ kind, dailyDutyId: null, locked: false, absenceTypeId }] : [])]), board)
}

export function withSwap(board: RosterBoard, date: string, a: string, b: string): RosterBoard {
  const of = (m: string) => board.cells.find(c => c.crewMemberId === m && c.date === date)?.entries ?? []
  const ea = of(a), eb = of(b)
  let next = withCell(withCell(board, a, date, () => eb), b, date, () => ea)
  const moved = new Map([...ea.map(e => [e.dailyDutyId, b] as const), ...eb.map(e => [e.dailyDutyId, a] as const)])
  next = { ...next, duties: next.duties.map(d => (moved.has(d.id) ? { ...d, crewMemberId: moved.get(d.id)! } : d)) }
  return next
}

export function withLock(board: RosterBoard, dutyIds: string[], locked: boolean): RosterBoard {
  const ids = new Set(dutyIds)
  return {
    ...board,
    duties: board.duties.map(d => (ids.has(d.id) ? { ...d, locked } : d)),
    cells:  board.cells.map(c => (c.entries.some(e => e.dailyDutyId && ids.has(e.dailyDutyId)) ? { ...c, entries: c.entries.map(e => (e.dailyDutyId && ids.has(e.dailyDutyId) ? { ...e, locked } : e)) } : c)),
  }
}

// what approving a request does to the crew member's duties on its days
export function requestImpact(
  r: { kind: string; startNotBefore: number | null; endNotAfter: number | null }, memberId: string, dates: string[], idx: BoardIndex, multiScope: boolean,
): string[] {
  const out: string[] = []
  for (const date of dates) {
    for (const e of idx.cellOf.get(`${memberId}|${date}`)?.entries ?? []) {
      const d = e.dailyDutyId ? idx.dutyById.get(e.dailyDutyId) : null
      if (!d) continue
      const name = `${dutyName(d, multiScope)} de ${fmtDay(date)}`
      if (r.kind === 'ABSENCE') out.push(`${name} fica sem operador`)
      else if ((r.startNotBefore != null && d.start != null && d.start < r.startNotBefore) || (r.endNotAfter != null && d.end != null && d.end > r.endNotAfter)) {
        out.push(`${name} fica fora do horário pedido`)
      }
    }
  }
  return out
}
