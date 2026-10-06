import { BadRequestException } from '@nestjs/common'
import { resolveExternalCode, type ExportIssue, type ExternalSystem } from '@nyx/schemas'
import { PrismaService } from '../../../../../prisma/prisma.service'
import { hhmm, type CodeRef, type Relief, type Trecho, type TrechoEnd, type TrechoGap, type TrechoTrip } from './plan-export.cuts'

// Layer 1 of the plan export (docs/proposal/plan_globus_export_v1.md §3.1–3.3) — loads the
// plan and turns it into one trecho per (program, block): the block's span from the first
// to the last trip of the program's line family, with everything the vehicle does inside it,
// plus the shift-change instants from the crew plan.

export interface AssembledCarro {
  blockId:     string
  blockNumber: number
  number:      number
  depot:       CodeRef
  trecho:      Trecho
  issues:      ExportIssue[]
}

export interface AssembledProgram {
  rootLineId: string
  lineCode:   string
  carros:     AssembledCarro[]
  issues:     ExportIssue[]
}

interface LineRow {
  id:            string
  code:          string
  parentLineId:  string | null
  externalCodes: unknown
}

const localitySelect = { code: true, externalCodes: true } as const

async function loadScope(prisma: PrismaService, vehiclePlanId: string, lineIds: string[]) {
  if (lineIds.length === 0) throw new BadRequestException('Nenhuma linha selecionada')

  const plan = await prisma.vehiclePlan.findUniqueOrThrow({
    where:  { id: vehiclePlanId },
    select: { scopeId: true, dayType: { select: { code: true } } },
  })
  const scopeLines: LineRow[] = await prisma.transitLine.findMany({
    where:  { scopeId: plan.scopeId },
    select: { id: true, code: true, parentLineId: true, externalCodes: true },
  })
  const lineById = new Map(scopeLines.map(l => [l.id, l]))
  const rootOf   = (id: string) => lineById.get(id)?.parentLineId ?? id

  for (const id of lineIds) if (!lineById.has(id)) throw new BadRequestException('Linha inválida para o escopo do plano')

  // a selected child stands for its parent — the parent's program carries the whole family
  const rootIds = [...new Set(lineIds.map(rootOf))]
    .sort((a, b) => lineById.get(a)!.code.localeCompare(lineById.get(b)!.code, undefined, { numeric: true }))

  const blocks = await prisma.vehicleBlock.findMany({
    where:  { vehiclePlanId, blockTrips: { some: { trip: { route: { line: { OR: [{ id: { in: rootIds } }, { parentLineId: { in: rootIds } }] } } } } } },
    select: {
      id: true, blockNumber: true, branchId: true,
      depot:          { select: localitySelect },
      blockTrips:     {
        select: {
          trip: {
            select: {
              id: true, departureMinutes: true, arrivalMinutes: true,
              route: { select: { lineId: true, direction: true, originLocality: { select: localitySelect } } },
            },
          },
        },
      },
      blockDeadruns:  { select: { type: true, departureMinutes: true, arrivalMinutes: true } },
      blockIntervals: { select: { departureMinutes: true, arrivalMinutes: true } },
    },
  })

  return { plan, lineById, rootOf, rootIds, blocks }
}

type LoadedBlock = Awaited<ReturnType<typeof loadScope>>['blocks'][number]

// rule 6 of the OSO export (oso-assembler.ts) — carros numbered by their first trip of the
// line family, all operators together, so the table names match the OSO's carro numbers
function osoNumbering(blocks: LoadedBlock[], inFamily: (lineId: string) => boolean): Map<string, number> {
  const firsts = blocks
    .map(b => ({ id: b.id, first: Math.min(...b.blockTrips.filter(bt => inFamily(bt.trip.route.lineId)).map(bt => bt.trip.departureMinutes)) }))
    .filter(b => Number.isFinite(b.first))
    .sort((a, b) => a.first - b.first)
  return new Map(firsts.map((b, i) => [b.id, i + 1]))
}

export async function loadExportOptions(prisma: PrismaService, vehiclePlanId: string, lineIds: string[]) {
  const { plan, lineById, rootIds, blocks } = await loadScope(prisma, vehiclePlanId, lineIds)

  const branchIds = [...new Set(blocks.map(b => b.branchId).filter((id): id is string => !!id))]
  const [crewPlans, planLines, scopeOperators, branches] = await Promise.all([
    prisma.crewPlan.findMany({
      where:   { vehiclePlanId },
      select:  { id: true, description: true, status: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.vehiclePlanLine.findMany({
      where:  { vehiclePlanId, lineId: { in: rootIds } },
      select: { lineId: true, lineSchedule: { select: { approvalRef: true } } },
    }),
    prisma.scopeOperator.findMany({
      where:  { scopeId: plan.scopeId, branchId: { in: branchIds } },
      select: { branchId: true, abbr: true },
    }),
    prisma.branch.findMany({ where: { id: { in: branchIds } }, select: { id: true, name: true } }),
  ])
  const approvalRef = new Map(planLines.map(pl => [pl.lineId, pl.lineSchedule?.approvalRef]))
  const abbr        = new Map(scopeOperators.map(o => [o.branchId, o.abbr]))
  const name        = new Map(branches.map(b => [b.id, b.name]))

  return {
    crewPlans: [...crewPlans].sort((a, b) => Number(b.status === 'ACTIVE') - Number(a.status === 'ACTIVE')),
    operators: branchIds
      .map(id => ({ branchId: id, label: abbr.get(id) ?? name.get(id) ?? id }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    programs: rootIds.map(id => {
      const line = lineById.get(id)!
      return { lineId: id, lineCode: line.code, defaultCode: approvalRef.get(id) ?? `${line.code}${plan.dayType.code}` }
    }),
    blocksWithoutOperator: blocks.filter(b => !b.branchId).length,
  }
}

export async function assembleExport(
  prisma:        PrismaService,
  vehiclePlanId: string,
  lineIds:       string[],
  branchId:      string,
  crewPlanId:    string,
  system:        ExternalSystem,
): Promise<AssembledProgram[]> {
  const { lineById, rootOf, rootIds, blocks } = await loadScope(prisma, vehiclePlanId, lineIds)

  const crewPlan = await prisma.crewPlan.findUnique({ where: { id: crewPlanId }, select: { vehiclePlanId: true } })
  if (crewPlan?.vehiclePlanId !== vehiclePlanId) throw new BadRequestException('Escala inválida para o plano')

  // only drivers change the vehicle's crew as far as the tables go
  const pieces = await prisma.dutyPiece.findMany({
    where:   { duty: { crewPlanId, role: 'DRIVER' }, vehicleBlockId: { in: blocks.map(b => b.id) } },
    select:  { dutyId: true, vehicleBlockId: true, startMinutes: true, endMinutes: true, isStale: true, startLocality: { select: localitySelect } },
    orderBy: { startMinutes: 'asc' },
  })
  const piecesByBlock = new Map<string, typeof pieces>()
  for (const p of pieces) piecesByBlock.set(p.vehicleBlockId!, [...(piecesByBlock.get(p.vehicleBlockId!) ?? []), p])

  const codeOf = (record: { code: string; externalCodes: unknown }): CodeRef => resolveExternalCode(record, system)

  const programs = new Map<string, AssembledProgram>(rootIds.map(id => [id, {
    rootLineId: id, lineCode: lineById.get(id)!.code, carros: [], issues: [],
  }]))
  const numbering = new Map(rootIds.map(id => [id, osoNumbering(blocks, lineId => rootOf(lineId) === id)]))

  for (const block of blocks) {
    const trips = block.blockTrips
      .map(bt => bt.trip)
      .sort((a, b) => a.departureMinutes - b.departureMinutes)

    // the trecho of each program in this block — when two overlap, the one with more trips
    // keeps the block and the other's trips inside it go along with COD_LINHA
    const candidates = rootIds
      .map(rootId => {
        const idx = trips.flatMap((t, i) => rootOf(t.route.lineId) === rootId ? [i] : [])
        return { rootId, lo: idx[0], hi: idx[idx.length - 1], count: idx.length, idx }
      })
      .filter(c => c.count > 0)
      .sort((a, b) => b.count - a.count)
    const accepted: typeof candidates = []
    for (const c of candidates) {
      if (accepted.some(a => c.lo <= a.hi && a.lo <= c.hi)) {
        const dropped = c.idx.filter(i => !accepted.some(a => a.lo <= i && i <= a.hi)).length
        const owner   = accepted.find(a => c.lo <= a.hi && a.lo <= c.hi)!
        programs.get(c.rootId)!.issues.push({
          code:    'BLOCK_DISPUTED',
          message: `Carro ${numbering.get(c.rootId)!.get(block.id)} (bloco ${block.blockNumber}) ficou com a linha ${lineById.get(owner.rootId)!.code}`
            + (dropped ? ` — ${dropped} viagem(ns) fora do trecho dela não exportada(s)` : ''),
        })
        continue
      }
      accepted.push(c)
    }

    if (block.branchId !== branchId) continue

    for (const c of accepted) {
      const program = programs.get(c.rootId)!
      const issues: ExportIssue[] = []
      const range   = trips.slice(c.lo, c.hi + 1)
      const blockPieces = piecesByBlock.get(block.id) ?? []
      const live        = blockPieces.filter(p => !p.isStale)
      if (live.length < blockPieces.length) issues.push({ code: 'CREW_STALE', message: 'Escala desatualizada neste carro — peças pendentes ignoradas' })

      const uncovered = range.filter(t => !covered(t.departureMinutes, t.arrivalMinutes, live))
      if (uncovered.length) issues.push({ code: 'CREW_UNCOVERED', message: `${uncovered.length} viagem(ns) sem motorista na escala (primeira às ${hhmm(uncovered[0].departureMinutes)})` })

      const reliefs: Relief[] = live.flatMap((p, i) =>
        i > 0 && p.dutyId !== live[i - 1].dutyId ? [{ at: p.startMinutes, locality: codeOf(p.startLocality) }] : [])

      program.carros.push({
        blockId:     block.id,
        blockNumber: block.blockNumber,
        number:      numbering.get(c.rootId)!.get(block.id)!,
        depot:       codeOf(block.depot),
        trecho:      buildTrecho(block, trips, c.lo, c.hi, reliefs, lineById, codeOf),
        issues,
      })
    }
  }

  for (const program of programs.values()) program.carros.sort((a, b) => a.number - b.number)
  return [...programs.values()]
}

function covered(dep: number, arr: number, pieces: { startMinutes: number; endMinutes: number }[]): boolean {
  let at = dep
  for (const p of pieces) {
    if (p.startMinutes <= at && p.endMinutes > at) at = p.endMinutes
    if (at >= arr) return true
  }
  return at >= arr
}

function buildTrecho(
  block:    LoadedBlock,
  trips:    LoadedBlock['blockTrips'][number]['trip'][],
  lo:       number,
  hi:       number,
  reliefs:  Relief[],
  lineById: Map<string, LineRow>,
  codeOf:   (record: { code: string; externalCodes: unknown }) => CodeRef,
): Trecho {
  // the gap a deadrun/interval sits in: after the last trip arriving by its departure
  const gapAfter = (dep: number) => {
    let k = -1
    trips.forEach((t, i) => { if (t.arrivalMinutes <= dep) k = i })
    return k
  }
  // the trip an ACCESS leads to: the first one departing at/after its arrival
  const tripAfter = (arr: number) => trips.findIndex(t => t.departureMinutes >= arr)

  const returns  = new Map<number, { dep: number; arr: number }>()
  const accesses = new Map<number, number>()
  const displacements = new Map<number, { dep: number; arr: number }[]>()
  for (const dr of block.blockDeadruns) {
    if (dr.type === 'ACCESS') accesses.set(tripAfter(dr.arrivalMinutes), dr.departureMinutes)
    else if (dr.type === 'RETURN') returns.set(gapAfter(dr.departureMinutes), { dep: dr.departureMinutes, arr: dr.arrivalMinutes })
    else {
      const g = gapAfter(dr.departureMinutes)
      displacements.set(g, [...(displacements.get(g) ?? []), { dep: dr.departureMinutes, arr: dr.arrivalMinutes }].sort((a, b) => a.dep - b.dep))
    }
  }
  const intervals = new Map<number, { dep: number; arr: number }>()
  for (const bi of [...block.blockIntervals].sort((a, b) => a.departureMinutes - b.departureMinutes)) {
    const g = gapAfter(bi.departureMinutes)
    if (!intervals.has(g)) intervals.set(g, { dep: bi.departureMinutes, arr: bi.arrivalMinutes })
  }

  const range = trips.slice(lo, hi + 1)
  const toTrip = (t: typeof trips[number]): TrechoTrip => ({
    tripId:    t.id,
    lineId:    t.route.lineId,
    line:      codeOf(lineById.get(t.route.lineId) ?? { code: t.route.lineId, externalCodes: null }),
    direction: t.route.direction,
    dep:       t.departureMinutes,
    arr:       t.arrivalMinutes,
    origin:    codeOf(t.route.originLocality),
  })

  const gaps: TrechoGap[] = range.slice(0, -1).map((_, j) => {
    const g   = lo + j
    const ret = returns.get(g)
    const acc = accesses.get(g + 1)
    return {
      displacements: displacements.get(g) ?? [],
      interval:      intervals.get(g),
      garage:        ret && acc != null ? { returnDep: ret.dep, returnArr: ret.arr, accessDep: acc } : undefined,
    }
  })

  let end: TrechoEnd = { kind: 'END' }
  const ret = returns.get(hi)
  if (ret) end = { kind: 'RETURN', arr: ret.arr }
  else if (intervals.has(hi) && hi + 1 < trips.length) {
    end = { kind: 'BREAK', at: intervals.get(hi)!.dep, nextDirection: trips[hi + 1].route.direction }
  }

  return { trips: range.map(toTrip), gaps, access: accesses.get(lo), end, reliefs }
}
