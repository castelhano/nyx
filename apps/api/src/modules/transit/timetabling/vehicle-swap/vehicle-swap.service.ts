import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../../../prisma/prisma.service'
import { CrewPlanService } from '../crew-plan/crew-plan.service'
import { VehiclePlanService } from '../vehicle-plan/vehicle-plan.service'
import { loadBlockRelief } from '../crew-plan/relief-points'
import { analyzeVehicleSwaps, type SwapBlock, type SwapCandidate, type SwapWrite, type MatrixEntry } from './vehicle-swap.calc'

// "Otimizar › Reduzir trocas de carro" on the ACTIVE crew plan. analyze() is read-only; apply() re-runs
// the analysis on the current state and writes the chosen swaps (VehiclePlan blocks +
// the pieces of every crew plan) in one transaction, closed by the VehiclePlan recalculate.

export type SwapCandidateView = Omit<SwapCandidate, 'write'>

@Injectable()
export class VehicleSwapService {
  constructor(
    private readonly prisma:       PrismaService,
    private readonly vehiclePlans: VehiclePlanService,
    private readonly crewPlans:    CrewPlanService,
  ) {}

  async analyze(crewPlanId: string): Promise<SwapCandidateView[]> {
    const { candidates } = await this.run(crewPlanId)
    return candidates.map(({ write: _w, ...view }) => view)
  }

  async apply(crewPlanId: string, keys: string[]): Promise<{ applied: number }> {
    if (!Array.isArray(keys) || keys.length === 0) throw new BadRequestException('Nenhuma troca selecionada')
    const { vehiclePlanId, candidates } = await this.run(crewPlanId)
    const byKey  = new Map(candidates.map(c => [c.key, c]))
    const chosen = keys.map(k => byKey.get(k))
    if (chosen.some(c => !c)) throw new ConflictException('A análise está desatualizada — abra novamente para ver as trocas atuais')

    await this.prisma.$transaction(async (tx) => {
      for (const c of chosen as SwapCandidate[]) {
        const w = c.write
        const touched = [c.x.blockId, c.y.blockId]

        // trips: park the moved ones on negative sequences (unique per block), then append
        // them after the receiving car's head in chronological order
        const heads = await tx.blockTrip.groupBy({
          by: ['vehicleBlockId'], where: { vehicleBlockId: { in: touched }, id: { notIn: w.moves.flatMap(m => m.blockTripIds) } },
          _max: { sequence: true },
        })
        const headMax = new Map(heads.map(h => [h.vehicleBlockId, h._max.sequence ?? -1]))
        let parked = 0
        for (const m of w.moves) {
          for (const id of m.blockTripIds) await tx.blockTrip.update({ where: { id }, data: { vehicleBlockId: m.toBlockId, sequence: -(++parked) } })
        }
        for (const m of w.moves) {
          // blockTripIds come from the calc in chronological order
          let seq = headMax.get(m.toBlockId) ?? -1
          for (const id of m.blockTripIds) await tx.blockTrip.update({ where: { id }, data: { sequence: ++seq } })
          if (m.deadrunIds.length)  await tx.blockDeadrun.updateMany({ where: { id: { in: m.deadrunIds } }, data: { vehicleBlockId: m.toBlockId } })
          if (m.intervalIds.length) await tx.blockInterval.updateMany({ where: { id: { in: m.intervalIds } }, data: { vehicleBlockId: m.toBlockId } })
        }

        if (w.deadrunDeletes.length) await tx.blockDeadrun.deleteMany({ where: { id: { in: w.deadrunDeletes } } })
        if (w.deadrunCreates.length) await tx.blockDeadrun.createMany({ data: w.deadrunCreates })
        for (const r of w.deadrunRetargets) {
          const { id, ...data } = r
          await tx.blockDeadrun.update({ where: { id }, data })
        }
        for (const { id, ...data } of w.intervalUpdates) await tx.blockInterval.update({ where: { id }, data })
        if (w.intervalDeletes.length) await tx.blockInterval.deleteMany({ where: { id: { in: w.intervalDeletes } } })
        await tx.vehicleBlock.updateMany({ where: { id: { in: touched } }, data: { isStale: true } })

        // plain block moves in bulk, adjusted pieces one by one
        const plain = (u: SwapWrite['pieceUpdates'][number]) => Object.keys(u.data).length === 1 && !!u.data.vehicleBlockId
        for (const blockId of touched) {
          const ids = w.pieceUpdates.filter(u => plain(u) && u.data.vehicleBlockId === blockId).map(u => u.pieceId)
          if (ids.length) await tx.dutyPiece.updateMany({ where: { id: { in: ids } }, data: { vehicleBlockId: blockId } })
        }
        for (const u of w.pieceUpdates.filter(u => !plain(u))) await tx.dutyPiece.update({ where: { id: u.pieceId }, data: u.data })
      }
      await this.vehiclePlans.recalculate(vehiclePlanId, tx)
    }, { timeout: 60_000 })

    await this.crewPlans.recalculateForVehiclePlan(vehiclePlanId)
    return { applied: chosen.length }
  }

  // loads the VehiclePlan's blocks, the live pieces of all its crew plans and the travel
  // matrix among their localities, and runs the pure analysis
  private async run(crewPlanId: string): Promise<{ vehiclePlanId: string; candidates: SwapCandidate[] }> {
    const plan = await this.prisma.crewPlan.findUnique({ where: { id: crewPlanId }, select: { status: true, vehiclePlanId: true } })
    if (!plan) throw new NotFoundException('crewPlan not found')
    if (plan.status !== 'ACTIVE') throw new BadRequestException('Disponível apenas na escala ativa')

    const [blockRows, pieceRows, activities] = await Promise.all([
      this.prisma.vehicleBlock.findMany({
        where:  { vehiclePlanId: plan.vehiclePlanId },
        select: {
          id: true, blockNumber: true, branchId: true, vehicleType: true, depotId: true,
          blockTrips: {
            select: {
              id: true, tripId: true,
              trip: { select: { departureMinutes: true, arrivalMinutes: true, route: { select: { originLocalityId: true, destinationLocalityId: true } } } },
            },
          },
          blockDeadruns:  { select: { id: true, type: true, originLocalityId: true, destinationLocalityId: true, departureMinutes: true, arrivalMinutes: true } },
          blockIntervals: { select: { id: true, departureMinutes: true, arrivalMinutes: true } },
        },
      }),
      this.prisma.dutyPiece.findMany({
        where:  { isStale: false, vehicleBlockId: { not: null }, duty: { crewPlan: { vehiclePlanId: plan.vehiclePlanId } } },
        select: {
          id: true, dutyId: true, vehicleBlockId: true, startMinutes: true, endMinutes: true, startLocalityId: true, endLocalityId: true,
          duty: { select: { role: true, crewPlanId: true } },
        },
      }),
      this.prisma.dutyActivity.findMany({ where: { duty: { crewPlanId } }, select: { dutyId: true, startMinutes: true, endMinutes: true } }),
    ])
    const relief = await loadBlockRelief(this.prisma, blockRows.map(b => b.id))

    const blocks: SwapBlock[] = blockRows.map(b => ({
      id: b.id, blockNumber: b.blockNumber, branchId: b.branchId, vehicleType: b.vehicleType, depotId: b.depotId,
      trips: b.blockTrips
        .map(bt => ({
          blockTripId: bt.id, tripId: bt.tripId,
          departureMinutes: bt.trip.departureMinutes, arrivalMinutes: bt.trip.arrivalMinutes,
          originLocalityId: bt.trip.route.originLocalityId, destinationLocalityId: bt.trip.route.destinationLocalityId,
        }))
        .sort((x, y) => x.departureMinutes - y.departureMinutes),
      deadruns:   b.blockDeadruns,
      intervals:  b.blockIntervals,
      tripPoints: (relief.get(b.id)?.points ?? []).filter(p => p.tripId),
    }))

    // travel matrix among every trip endpoint and depot of the plan
    const localityIds = new Set<string>()
    for (const b of blocks) {
      localityIds.add(b.depotId)
      for (const t of b.trips) { localityIds.add(t.originLocalityId); localityIds.add(t.destinationLocalityId) }
    }
    const ids = [...localityIds]
    const matrixRows = await this.prisma.travelTimeMatrix.findMany({
      where:  { originId: { in: ids }, destinationId: { in: ids } },
      select: { originId: true, destinationId: true, baseMinutes: true, speedRatio: true, distanceKm: true },
    })
    const matrix = new Map<string, MatrixEntry>(matrixRows.map(m => [
      `${m.originId}:${m.destinationId}`, { minutes: Math.round(m.baseMinutes * m.speedRatio), km: m.distanceKm },
    ]))

    const candidates = analyzeVehicleSwaps({
      blocks,
      pieces: pieceRows.map(p => ({
        id: p.id, dutyId: p.dutyId, crewPlanId: p.duty.crewPlanId, role: p.duty.role, vehicleBlockId: p.vehicleBlockId!,
        startMinutes: p.startMinutes, endMinutes: p.endMinutes, startLocalityId: p.startLocalityId, endLocalityId: p.endLocalityId,
      })),
      activePlanId: crewPlanId,
      activities,
      matrix: (from, to) => matrix.get(`${from}:${to}`),
    })
    return { vehiclePlanId: plan.vehiclePlanId, candidates }
  }
}
