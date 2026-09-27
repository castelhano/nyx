import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  crewPlanSchema, crewSettingsSchema, dayTypePatternSchema,
  CrewPlan, CreateCrewPlanDto, UpdateCrewPlanDto, CrewSettings, CrewPlanSummary,
} from '@nyx/schemas'
import type { PlanActivationPreview } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'
import { TransitCrewConfigService } from '../../settings/transit-crew-config.service'
import { loadBlockRelief } from './relief-points'
import { loadCrewWalk } from './crew-walk'
import { computeCrewPlan } from './crew-scoring.calc'
import {
  activationEffect, addDays, applyEffect, assertRetroactiveAllowed, dayOf, fmtDay, parseStartDate, toDbDate,
  type ActivationEffect, type VersionRow,
} from '../plan-validity'

@Injectable()
export class CrewPlanService extends BaseService<CrewPlan, CreateCrewPlanDto, UpdateCrewPlanDto> {
  constructor(
    prisma: PrismaService,
    private readonly crewConfig: TransitCrewConfigService,
  ) {
    super(prisma, 'crewPlan', crewPlanSchema, 'transit')
  }

  // status/validity only change through activation; summary/settings/constraints/generatedAt
  // have their own endpoints (or the solver) — a generic POST/PATCH must not write them.
  private static stripManaged(dto: Record<string, unknown>) {
    const {
      status: _s, validFrom: _vf, validTo: _vt, summary: _sm, settings: _st,
      constraints: _c, generatedAt: _g, ...rest
    } = dto
    return rest
  }

  override async create(dto: CreateCrewPlanDto): Promise<CrewPlan> {
    const data = CrewPlanService.stripManaged(dto)
    const vehiclePlan = await this.prisma.vehiclePlan.findUnique({
      where: { id: typeof data.vehiclePlanId === 'string' ? data.vehiclePlanId : '' }, select: { id: true },
    })
    if (!vehiclePlan) throw new BadRequestException('Planejamento de veículos não encontrado')
    return super.create(data as CreateCrewPlanDto)
  }

  override async update(id: string, dto: UpdateCrewPlanDto): Promise<CrewPlan> {
    const { vehiclePlanId: _vp, ...rest } = CrewPlanService.stripManaged(dto)
    return super.update(id, rest)
  }

  override async remove(id: string): Promise<void> {
    const plan = await this.prisma.crewPlan.findUnique({ where: { id }, select: { status: true } })
    if (plan && plan.status !== 'DRAFT') throw new BadRequestException('Escala ativa ou substituída não pode ser excluída')
    return super.remove(id)
  }

  // ── settings ───────────────────────────────────────────────────────────────
  // CrewPlan.settings (full snapshot) ?? Settings(transit.crew, Scope) ?? global

  async resolveSettings(crewPlanId: string): Promise<{ settings: CrewSettings; isCustom: boolean }> {
    const plan = await this.prisma.crewPlan.findUnique({
      where:  { id: crewPlanId },
      select: { settings: true, vehiclePlan: { select: { scopeId: true } } },
    })
    if (!plan) throw new NotFoundException('crewPlan not found')
    if (plan.settings) return { settings: crewSettingsSchema.parse(plan.settings), isCustom: true }
    return { settings: await this.crewConfig.get(plan.vehiclePlan.scopeId), isCustom: false }
  }

  // For the plan's settings modal: the effective settings plus what the plan would inherit
  // (Scope/global) without its own copy — the modal diffs against it.
  async getSettingsView(id: string): Promise<{ settings: CrewSettings; isCustom: boolean; inherited: CrewSettings }> {
    const plan = await this.prisma.crewPlan.findUnique({ where: { id }, select: { vehiclePlan: { select: { scopeId: true } } } })
    if (!plan) throw new NotFoundException('crewPlan not found')
    const [{ settings, isCustom }, inherited] = await Promise.all([
      this.resolveSettings(id),
      this.crewConfig.get(plan.vehiclePlan.scopeId),
    ])
    return { settings, isCustom, inherited }
  }

  // "Customize": stores a full copy of the effective settings (Scope/global) in the plan
  async customizeSettings(id: string): Promise<{ settings: CrewSettings; isCustom: boolean }> {
    const { settings } = await this.resolveSettings(id)
    await this.prisma.crewPlan.update({ where: { id }, data: { settings } })
    await this.recalculate(id)
    return { settings, isCustom: true }
  }

  async putSettings(id: string, dto: unknown): Promise<{ settings: CrewSettings; isCustom: boolean }> {
    await this.findOne(id)
    const parsed = crewSettingsSchema.safeParse(dto)
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`))
    await this.prisma.crewPlan.update({ where: { id }, data: { settings: parsed.data } })
    await this.recalculate(id)
    return { settings: parsed.data, isCustom: true }
  }

  // "Restore default": goes back to inheriting Scope/global live
  async resetSettings(id: string): Promise<{ settings: CrewSettings; isCustom: boolean }> {
    await this.findOne(id)
    await this.prisma.crewPlan.update({ where: { id }, data: { settings: Prisma.DbNull } })
    await this.recalculate(id)
    return this.resolveSettings(id)
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────
  // The crew plan starts on `startDate`, inside its
  // VehiclePlan's vigência (which may itself start in the future). Without `confirm` nothing is
  // written: the result is the preview. Stale duties or uncovered block spans block the
  // activation (the schedule doesn't fit the vehicle plan); issues don't — the UI asks.
  async activate(id: string, startDate: unknown, confirm: boolean): Promise<PlanActivationPreview> {
    const start = parseStartDate(startDate)
    const plan = await this.prisma.crewPlan.findUnique({
      where:  { id },
      select: { status: true, vehiclePlanId: true, vehiclePlan: { select: { status: true, validFrom: true, validTo: true } } },
    })
    if (!plan) throw new NotFoundException('crewPlan not found')
    if (plan.status !== 'DRAFT') throw new BadRequestException('Só é possível ativar uma escala em rascunho')
    const vp = plan.vehiclePlan
    if (vp.status === 'DRAFT') throw new BadRequestException('Só é possível ativar a escala de um planejamento ativo')
    const vpFrom = vp.validFrom ? dayOf(vp.validFrom) : null
    const vpTo   = vp.validTo ? dayOf(vp.validTo) : null
    if ((vpFrom && start < vpFrom) || (vpTo && start > vpTo)) {
      const window = vpTo ? `${fmtDay(vpFrom ?? start)} a ${fmtDay(vpTo)}` : `a partir de ${fmtDay(vpFrom ?? start)}`
      throw new BadRequestException(`A escala precisa começar dentro da vigência do planejamento (${window})`)
    }

    const others = (await this.prisma.crewPlan.findMany({
      where:  { vehiclePlanId: plan.vehiclePlanId, id: { not: id }, status: { not: 'DRAFT' } },
      select: { id: true, description: true, validFrom: true, validTo: true },
    })).map(o => ({ ...o, label: o.description || 'Sem descrição' }))
    assertRetroactiveAllowed(others, start)
    const effect = activationEffect(others, start)

    await this.recalculate(id)
    const { summary } = (await this.prisma.crewPlan.findUnique({ where: { id }, select: { summary: true } }))!
    const s = summary as CrewPlanSummary
    if (s.staleDutyCount > 0) throw new BadRequestException(`${s.staleDutyCount} jornada(s) desatualizada(s) em relação ao planejamento`)
    if (s.uncoveredMinutes > 0) throw new BadRequestException(`${s.uncovered.length} trecho(s) de bloco sem motorista`)

    if (confirm) {
      await this.prisma.$transaction(async (tx) => {
        await applyEffect(tx.crewPlan, effect)
        await tx.crewPlan.update({ where: { id }, data: { status: 'ACTIVE', validFrom: toDbDate(start), validTo: null } })
      })
    }
    return { startDate: start, ...effect, crewSuperseded: [], crewReverted: [], warnings: [], applied: confirm }
  }

  // A VehiclePlan's crew plans follow its cut: the ones reaching past its new end are cut to it
  // (or reverted when they'd only start after it); a reverted VehiclePlan takes all of them back.
  static cascade(
    crewPlans: (VersionRow & { vehiclePlanId: string })[],
    vehicleEffect: ActivationEffect,
  ): ActivationEffect {
    const out: ActivationEffect = { superseded: [], reverted: [] }
    for (const vp of vehicleEffect.superseded) {
      const e = activationEffect(crewPlans.filter(c => c.vehiclePlanId === vp.id), addDays(vp.validTo, 1))
      out.superseded.push(...e.superseded)
      out.reverted.push(...e.reverted)
    }
    const reverted = new Set(vehicleEffect.reverted.map(r => r.id))
    for (const c of crewPlans) if (reverted.has(c.vehiclePlanId)) out.reverted.push({ id: c.id, label: c.label })
    return out
  }

  // a substituted crew plan is history — its duties can't change anymore
  async assertEditable(crewPlanId: string): Promise<void> {
    const plan = await this.prisma.crewPlan.findUnique({ where: { id: crewPlanId }, select: { status: true } })
    if (plan?.status === 'SUPERSEDED') throw new BadRequestException('Escala substituída não pode ser alterada — duplique para editar')
  }

  async assertDutyEditable(dutyId: string): Promise<void> {
    const duty = await this.prisma.duty.findUnique({ where: { id: dutyId }, select: { crewPlanId: true } })
    if (duty) await this.assertEditable(duty.crewPlanId)
  }

  // Copy within the same VehiclePlan — duties, pieces and activities (blocks are shared, so
  // pieces keep pointing at the same VehicleBlock rows).
  async duplicate(id: string): Promise<CrewPlan> {
    const src = await this.prisma.crewPlan.findUnique({
      where:   { id },
      include: { duties: { include: { pieces: true, activities: true } } },
    })
    if (!src) throw new NotFoundException('crewPlan not found')

    const created = await this.prisma.$transaction(async (tx) => {
      const copy = await tx.crewPlan.create({
        data: {
          vehiclePlanId: src.vehiclePlanId,
          description:   src.description ? `${src.description} (cópia)` : 'Cópia',
          settings:      src.settings ?? Prisma.DbNull,
          notes:         src.notes,
        },
      })
      for (const d of src.duties) {
        await tx.duty.create({
          data: {
            crewPlanId: copy.id, role: d.role, dutyNumber: d.dutyNumber, kind: d.kind,
            branchId: d.branchId, notes: d.notes,
            pieces: {
              create: d.pieces.map(p => ({
                vehicleBlockId: p.vehicleBlockId, sequence: p.sequence,
                startMinutes: p.startMinutes, endMinutes: p.endMinutes,
                startLocalityId: p.startLocalityId, endLocalityId: p.endLocalityId,
              })),
            },
            activities: {
              create: d.activities.map(a => ({
                type: a.type, intervalTypeId: a.intervalTypeId,
                startMinutes: a.startMinutes, endMinutes: a.endMinutes,
                originLocalityId: a.originLocalityId, destinationLocalityId: a.destinationLocalityId,
              })),
            },
          },
        })
      }
      return copy
    })
    await this.recalculate(created.id)
    return this.findOne(created.id)
  }

  async recalculateForVehiclePlan(vehiclePlanId: string): Promise<void> {
    const plans = await this.prisma.crewPlan.findMany({ where: { vehiclePlanId }, select: { id: true } })
    for (const p of plans) await this.recalculate(p.id)
  }

  // ── board (crew plan screen) ───────────────────────────────────────────────

  // Which crew plan the Vehicles ⇄ Crew switch opens: the ACTIVE one, else the latest.
  async resolveForVehiclePlan(vehiclePlanId: string): Promise<{ id: string } | null> {
    const active = await this.prisma.crewPlan.findFirst({ where: { vehiclePlanId, status: 'ACTIVE' }, select: { id: true } })
    if (active) return active
    return this.prisma.crewPlan.findFirst({ where: { vehiclePlanId }, orderBy: { createdAt: 'desc' }, select: { id: true } })
  }

  // Everything the crew plan screen renders, in one call. `recalculate` is set by the screen
  // when it opens a plan — that's when upstream changes (Scope/global settings, VehiclePlan
  // edits made through paths that don't trigger recalculate) get picked up. Refetches after
  // an edit skip it: every duty/piece/activity write already recalculated.
  async getBoard(id: string, recalculate = false) {
    if (recalculate) await this.recalculate(id)

    const plan = await this.prisma.crewPlan.findUnique({
      where:   { id },
      include: {
        vehiclePlan: {
          select: {
            id: true, description: true, status: true, scopeId: true,
            scope: { select: { name: true, lines: { select: { code: true } } } }, dayType: { select: { name: true } },
          },
        },
      },
    })
    if (!plan) throw new NotFoundException('crewPlan not found')

    const [versions, blockRows, duties, operators, { settings, isCustom }] = await Promise.all([
      this.prisma.crewPlan.findMany({
        where:   { vehiclePlanId: plan.vehiclePlanId },
        orderBy: { createdAt: 'desc' },
        select:  { id: true, description: true, status: true, createdAt: true },
      }),
      this.prisma.vehicleBlock.findMany({
        where:   { vehiclePlanId: plan.vehiclePlanId },
        orderBy: { blockNumber: 'asc' },
        select: {
          id: true, blockNumber: true, branchId: true,
          blockTrips: {
            select: {
              trip: {
                select: {
                  id: true, departureMinutes: true, arrivalMinutes: true,
                  route: { select: { direction: true, line: { select: { code: true } } } },
                },
              },
            },
          },
          blockDeadruns:  { select: { id: true, type: true, departureMinutes: true, arrivalMinutes: true } },
          blockIntervals: { select: { id: true, departureMinutes: true, arrivalMinutes: true, intervalTypeId: true, intervalType: { select: { name: true } } } },
        },
      }),
      this.prisma.duty.findMany({
        where:   { crewPlanId: id },
        orderBy: [{ role: 'asc' }, { dutyNumber: 'asc' }],
        include: {
          pieces:     { orderBy: { sequence: 'asc' } },
          activities: { orderBy: { startMinutes: 'asc' }, include: { intervalType: { select: { name: true, isPaid: true } } } },
        },
      }),
      this.prisma.scopeOperator.findMany({
        where:  { scopeId: plan.vehiclePlan.scopeId },
        select: { branchId: true, abbr: true, branch: { select: { name: true } } },
      }),
      this.resolveSettings(id),
    ])

    const relief = await loadBlockRelief(this.prisma, blockRows.map(b => b.id))

    const localityIds = new Set<string>()
    for (const r of relief.values()) for (const p of r.points) localityIds.add(p.localityId)
    for (const d of duties) for (const p of d.pieces) { localityIds.add(p.startLocalityId); localityIds.add(p.endLocalityId) }
    const localities = await this.prisma.transitLocality.findMany({
      where: { id: { in: [...localityIds] } }, select: { id: true, name: true, abbr: true },
    })

    return {
      plan: {
        id: plan.id, description: plan.description, status: plan.status,
        validFrom: plan.validFrom, validTo: plan.validTo, summary: plan.summary, notes: plan.notes,
        isCustomSettings: isCustom,
        // what the duty view needs to draw implicit sign-on/off (see crew-scoring.calc.ts)
        signOnMinutes:  settings.signOnMinutes,
        signOffMinutes: settings.signOffMinutes,
      },
      vehiclePlan: {
        id: plan.vehiclePlan.id, description: plan.vehiclePlan.description, status: plan.vehiclePlan.status,
        scopeName: plan.vehiclePlan.scope.name, dayTypeName: plan.vehiclePlan.dayType.name,
      },
      versions,
      operators: operators.map(o => ({ branchId: o.branchId, abbr: o.abbr, name: o.branch.name })),
      // every line of the Scope — line colors are indexed over this set (same as the
      // vehicle plan Gantt), so a line has the same color on both screens
      lineCodes: plan.vehiclePlan.scope.lines.map(l => l.code),
      localities,
      blocks: blockRows.map(b => {
        const r = relief.get(b.id)
        return {
          id: b.id, blockNumber: b.blockNumber, branchId: b.branchId,
          window:       r?.window ?? null,
          serviceSpans: r?.serviceSpans ?? [],
          points:       r?.points ?? [],
          trips: b.blockTrips
            .map(({ trip }) => ({
              id: trip.id, departureMinutes: trip.departureMinutes, arrivalMinutes: trip.arrivalMinutes,
              lineCode: trip.route.line.code, direction: trip.route.direction,
            }))
            .sort((x, y) => x.departureMinutes - y.departureMinutes),
          deadruns:  b.blockDeadruns,
          intervals: b.blockIntervals.map(i => ({
            id: i.id, departureMinutes: i.departureMinutes, arrivalMinutes: i.arrivalMinutes,
            intervalTypeId: i.intervalTypeId, intervalTypeName: i.intervalType.name,
          })),
        }
      }),
      duties: duties.map(d => ({
        id: d.id, role: d.role, dutyNumber: d.dutyNumber, kind: d.kind, branchId: d.branchId, notes: d.notes,
        summary: d.summary, issues: d.issues ?? [], isStale: d.isStale, hasIssues: d.hasIssues,
        locked: (d.constraints as { locked?: boolean } | null)?.locked === true,
        pieces: d.pieces.map(p => ({
          id: p.id, vehicleBlockId: p.vehicleBlockId, sequence: p.sequence,
          startMinutes: p.startMinutes, endMinutes: p.endMinutes,
          startLocalityId: p.startLocalityId, endLocalityId: p.endLocalityId,
          isStale: p.isStale, staleReason: p.staleReason,
        })),
        activities: d.activities.map(a => ({
          id: a.id, type: a.type, intervalTypeId: a.intervalTypeId, intervalTypeName: a.intervalType?.name ?? null,
          isPaidBreak: a.type === 'BREAK' && !!a.intervalType?.isPaid,
          startMinutes: a.startMinutes, endMinutes: a.endMinutes,
        })),
      })),
    }
  }

  // ── recalculate ────────────────────────────────────────────────────────────
  // The only write path for piece staleness, duty summary/issues and the plan summary.
  // Runs after every duty/piece/activity write, when the plan is opened (settings may have
  // changed upstream) and after its VehiclePlan is edited.
  async recalculate(id: string): Promise<void> {
    const plan = await this.prisma.crewPlan.findUnique({
      where:  { id },
      select: { vehiclePlanId: true, summary: true, vehiclePlan: { select: { dayType: { select: { pattern: true } } } } },
    })
    if (!plan) throw new NotFoundException('crewPlan not found')

    const [{ settings }, blockRows, duties] = await Promise.all([
      this.resolveSettings(id),
      this.prisma.vehicleBlock.findMany({ where: { vehiclePlanId: plan.vehiclePlanId }, select: { id: true } }),
      this.prisma.duty.findMany({
        where:  { crewPlanId: id },
        select: {
          id: true, role: true, kind: true, branchId: true,
          summary: true, issues: true, isStale: true,
          pieces:     { select: { id: true, vehicleBlockId: true, startMinutes: true, endMinutes: true, startLocalityId: true, endLocalityId: true, isStale: true, staleReason: true } },
          activities: { select: { id: true, type: true, intervalTypeId: true, startMinutes: true, endMinutes: true, intervalType: { select: { isPaid: true } } } },
        },
      }),
    ])
    const [relief, mealStops] = await Promise.all([
      loadBlockRelief(this.prisma, blockRows.map(b => b.id)),
      settings.mealBreakIntervalTypeId
        ? this.prisma.routeLocality.findMany({ where: { allowsMealBreak: true, localityId: { not: null } }, select: { routeId: true, localityId: true } })
        : Promise.resolve([]),
    ])

    // crew walking between the end of a piece and the start of the next, when they differ
    const pairs = new Map<string, { originId: string; destinationId: string }>()
    for (const d of duties) {
      const sorted = [...d.pieces].sort((a, b) => a.startMinutes - b.startMinutes)
      for (let i = 1; i < sorted.length; i++) {
        const from = sorted[i - 1].endLocalityId, to = sorted[i].startLocalityId
        if (from !== to) pairs.set(`${from}:${to}`, { originId: from, destinationId: to })
      }
    }
    const walk = await loadCrewWalk(this.prisma, [...new Set([...pairs.values()].flatMap(p => [p.originId, p.destinationId]))], [...pairs.values()])

    const result = computeCrewPlan({
      settings,
      blocks: [...relief.entries()].map(([blockId, r]) => ({ id: blockId, branchId: r.branchId, window: r.window, serviceSpans: r.serviceSpans, points: r.points, trips: r.trips })),
      duties: duties.map(d => ({
        id: d.id, role: d.role, kind: d.kind, branchId: d.branchId,
        pieces:     d.pieces,
        activities: d.activities.map(a => ({
          id: a.id, type: a.type, intervalTypeId: a.intervalTypeId, startMinutes: a.startMinutes, endMinutes: a.endMinutes,
          isPaidBreak: a.type === 'BREAK' && !!a.intervalType?.isPaid,
        })),
      })),
      walk,
      mealStops: new Set(mealStops.map(s => `${s.routeId}:${s.localityId}`)),
      repeatsNextDay: repeatsNextDay(plan.vehiclePlan.dayType.pattern),
    })

    // only rows whose derived state actually changed are written — a single piece edit
    // usually touches one or two duties, not the whole plan
    const same       = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b)
    const piecesById = new Map(duties.flatMap(d => d.pieces).map(p => [p.id, p]))
    const dutiesById = new Map(duties.map(d => [d.id, d]))
    await this.prisma.$transaction(async (tx) => {
      for (const [pieceId, st] of result.pieces) {
        const cur = piecesById.get(pieceId)!
        if (cur.isStale !== st.isStale || cur.staleReason !== st.staleReason) {
          await tx.dutyPiece.update({ where: { id: pieceId }, data: { isStale: st.isStale, staleReason: st.staleReason } })
        }
      }
      for (const [dutyId, d] of result.duties) {
        const cur = dutiesById.get(dutyId)!
        if (cur.isStale === d.isStale && same(cur.summary, d.summary) && same(cur.issues, d.issues)) continue
        await tx.duty.update({
          where: { id: dutyId },
          data:  { summary: d.summary, issues: d.issues, hasIssues: d.issues.length > 0, isStale: d.isStale },
        })
      }
      if (!same(plan.summary, result.summary)) await tx.crewPlan.update({ where: { id }, data: { summary: result.summary } })
    }, { timeout: 30_000 })
  }
}

// JSON with object keys sorted — jsonb doesn't preserve key order, so comparing a stored
// value against a freshly computed one needs an order-insensitive form
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  )
}

// whether the day type runs on two consecutive days, so a duty can be assumed to repeat the next day
export function repeatsNextDay(pattern: unknown): boolean {
  const p = dayTypePatternSchema.safeParse(pattern)
  if (!p.success) return false
  if (p.data.type === 'month_window' && !p.data.baseWeekdays) return p.data.days > 1
  const days = p.data.type === 'weekdays' ? p.data.days : p.data.baseWeekdays ?? []
  return days.some(d => days.includes(d % 7 + 1))
}
