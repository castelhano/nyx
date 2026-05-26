import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../../../prisma/prisma.service'

@Injectable()
export class OsrmService {
  private readonly logger = new Logger(OsrmService.name)
  private readonly osrmUrl = process.env.OSRM_URL ?? 'http://localhost:5000'

  constructor(private readonly prisma: PrismaService) {}

  async generateMatrixForAllBranches(): Promise<void> {
    const branches = await this.prisma.branch.findMany({ select: { id: true } })
    await Promise.all(branches.map((b) => this.generateMatrix(b.id).catch(() => {})))
  }

  async generateMatrix(branchId: string): Promise<void> {
    const localities = await this.prisma.transitLocality.findMany({
      select: { id: true, lat: true, lng: true },
    })

    if (localities.length < 2) return

    const coords = localities.map((l) => `${l.lng},${l.lat}`).join(';')
    const url    = `${this.osrmUrl}/table/v1/driving/${coords}?annotations=duration,distance`

    let data: { durations: number[][], distances: number[][] }
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`OSRM returned ${res.status}`)
      data = await res.json() as { durations: number[][], distances: number[][] }
    } catch (err) {
      this.logger.warn(`OSRM matrix failed for branch ${branchId}: ${(err as Error).message}`)
      return
    }

    // collect manual overrides to skip them
    const manualEntries = await this.prisma.travelTimeMatrix.findMany({
      where:  { branchId, source: 'MANUAL' },
      select: { originId: true, destinationId: true },
    })
    const manualSet = new Set(manualEntries.map((r) => `${r.originId}:${r.destinationId}`))

    const upserts: Promise<unknown>[] = []

    for (let i = 0; i < localities.length; i++) {
      for (let j = 0; j < localities.length; j++) {
        if (i === j) continue
        const origin      = localities[i]
        const destination = localities[j]
        if (manualSet.has(`${origin.id}:${destination.id}`)) continue

        const baseMinutes = data.durations[i][j] / 60
        const distanceKm  = data.distances[i][j] / 1000

        upserts.push(
          this.prisma.travelTimeMatrix.upsert({
            where:  { branchId_originId_destinationId: { branchId, originId: origin.id, destinationId: destination.id } },
            update: { baseMinutes, distanceKm, source: 'OSRM' },
            create: { branchId, originId: origin.id, destinationId: destination.id, baseMinutes, distanceKm, source: 'OSRM' },
          }),
        )
      }
    }

    await Promise.all(upserts)
    this.logger.log(`OSRM matrix updated: branch=${branchId} localities=${localities.length} pairs=${upserts.length}`)
  }
}
