import { Injectable, BadRequestException } from '@nestjs/common'
import type ExcelJS from 'exceljs'
import { PrismaService } from '../../../../prisma/prisma.service'
import { assembleOso } from './oso/oso-assembler'
import { resolveLayouts } from './oso/oso-layout.resolver'
import { bandCarros } from './oso/oso-banding'
import { computeOsoSummary } from './oso/oso-summary'
import { computeOsoObservations } from './oso/oso-observations'
import { renderOsoWorkbook, type RenderOsoSheetInput } from './oso/oso-workbook.renderer'

// Orchestrates the OSO export pipeline (docs/proposal/plan_oso_export_v1.md, Fase 3) for one
// or more lines of a plan — one workbook sheet per requested line. Sheet order follows regra
// 13: operator (EMPRESA) first, then line code, natural sort.
@Injectable()
export class VehiclePlanExportService {
  constructor(private readonly prisma: PrismaService) {}

  async exportOso(vehiclePlanId: string, lineIds: string[]): Promise<ExcelJS.Workbook> {
    if (lineIds.length === 0) throw new BadRequestException('Nenhuma linha selecionada')

    const db   = this.prisma as any
    const plan = await db.vehiclePlan.findUniqueOrThrow({
      where:  { id: vehiclePlanId },
      select: { id: true, scopeId: true },
    })

    const lines = await db.transitLine.findMany({
      where:  { id: { in: lineIds }, scopeId: plan.scopeId },
      select: { id: true, code: true, name: true },
    })
    if (lines.length !== lineIds.length) throw new BadRequestException('Linha inválida para o escopo do plano')
    const lineById = new Map<string, { id: string; code: string; name: string }>(
      lines.map((l: any) => [l.id, l]),
    )

    const scope     = await db.scope.findUniqueOrThrow({ where: { id: plan.scopeId }, select: { name: true, logoUrl: true, osoConfig: true } })
    const osoConfig = scope.osoConfig ?? {}
    const scopeConfig = {
      name:       scope.name,
      logoUrl:    scope.logoUrl,
      organName:  osoConfig.organName,
      signatures: osoConfig.signatures ?? [],
    }

    // the LineSchedule pinned to this line within this plan (VehiclePlanLine.lineScheduleId)
    // supplies the "vigência" (validFrom) printed in the header — null while the line has no
    // approved schedule pinned yet
    const planLines = await db.vehiclePlanLine.findMany({
      where:  { vehiclePlanId, lineId: { in: lineIds } },
      select: { lineId: true, lineSchedule: { select: { validFrom: true } } },
    })
    const validFromByLineId = new Map<string, Date | null>(
      planLines.map((pl: any) => [pl.lineId, pl.lineSchedule?.validFrom ?? null]),
    )

    const built = await Promise.all(lineIds.map(async (lineId) => {
      const line = lineById.get(lineId)!
      const assembled     = await assembleOso(this.prisma, vehiclePlanId, lineId)
      const layouts       = await resolveLayouts(this.prisma, assembled)
      const bands         = bandCarros(assembled, layouts)
      const summary       = await computeOsoSummary(this.prisma, assembled)
      const observations  = computeOsoObservations(assembled)
      const validFrom     = validFromByLineId.get(lineId) ?? null
      return { line, assembled, layouts, bands, summary, observations, validFrom }
    }))

    built.sort((a, b) => {
      const opA = a.assembled.carros[0]?.operatorLabel ?? ''
      const opB = b.assembled.carros[0]?.operatorLabel ?? ''
      return opA.localeCompare(opB, undefined, { numeric: true })
        || a.line.code.localeCompare(b.line.code, undefined, { numeric: true })
    })

    const sheets: RenderOsoSheetInput[] = built.map(({ line, assembled, layouts, bands, summary, observations, validFrom }) => ({
      lineCode: line.code,
      lineName: line.name,
      assembled, layouts, bands, summary, observations, validFrom,
      scope:    scopeConfig,
    }))

    return renderOsoWorkbook(this.prisma, sheets)
  }
}
