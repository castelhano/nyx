import { BadRequestException, Injectable } from '@nestjs/common'
import { z } from 'zod'
import { EXPORT_LAYOUTS, EXTERNAL_SYSTEMS, type ExportOptions, type ExportPreview, type ExportPreviewRequest } from '@nyx/schemas'
import { PrismaService } from '../../../../../prisma/prisma.service'
import { CrewPlanService } from '../../crew-plan/crew-plan.service'
import { assembleExport, loadExportOptions } from './plan-export.assembler'
import { cutTrecho } from './plan-export.cuts'
import { buildGlobusCarro } from './profiles/globus.profile'

const previewRequestSchema = z.object({
  system:       z.enum(EXTERNAL_SYSTEMS),
  crewPlanId:   z.uuid(),
  branchId:     z.uuid(),
  lineIds:      z.array(z.uuid()).min(1),
  programCodes: z.record(z.string(), z.string()),
})

// Plan export to external systems (docs/proposal/plan_globus_export_v1.md): assembler →
// cuts → the system's profile. The file itself is built by the client from the preview.
@Injectable()
export class PlanExportService {
  constructor(
    private readonly prisma:    PrismaService,
    private readonly crewPlans: CrewPlanService,
  ) {}

  options(vehiclePlanId: string, lineIds: string[]): Promise<ExportOptions> {
    return loadExportOptions(this.prisma, vehiclePlanId, lineIds)
  }

  async preview(vehiclePlanId: string, body: unknown): Promise<ExportPreview> {
    const parsed = previewRequestSchema.safeParse(body)
    if (!parsed.success) throw new BadRequestException('Parâmetros de exportação inválidos')
    const req: ExportPreviewRequest = parsed.data

    const [programs, { settings }] = await Promise.all([
      assembleExport(this.prisma, vehiclePlanId, req.lineIds, req.branchId, req.crewPlanId, req.system),
      this.crewPlans.resolveSettings(req.crewPlanId),
    ])

    // the code typed per program goes into the layout's program-level field
    const programField = EXPORT_LAYOUTS[req.system].layout.find(f => f.level === 'program')!.field

    return {
      system:   req.system,
      issues:   [],
      programs: programs.map(p => ({
        lineId:   p.rootLineId,
        lineCode: p.lineCode,
        fields:   { [programField]: req.programCodes[p.rootLineId] ?? '' },
        carros:   p.carros.map(c => {
          const segments = cutTrecho(c.trecho)
          switch (req.system) {
            case 'GLOBUS':
              return buildGlobusCarro({ ...c, segments }, { rootLineId: p.rootLineId, prepMinutes: settings.signOnMinutes })
          }
        }),
        ...(p.issues.length ? { issues: p.issues } : {}),
      })),
    }
  }
}
