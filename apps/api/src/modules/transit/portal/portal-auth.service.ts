import { BadRequestException, HttpException, HttpStatus, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as argon2 from 'argon2'
import { portalChangePinSchema, portalLoginSchema, type PortalLoginResult } from '@nyx/schemas'
import { PrismaService } from '../../../prisma/prisma.service'

// The crew portal's credentials: matrícula + 6-digit PIN (CrewAccess). The first PIN is the first 6
// digits of his CPF and must be changed at the first login; a staff reset goes back to it and
// invalidates the tokens already given (tokenVersion). Wrong PINs lock the access for a while;
// logins are also limited per IP. Its own secret — a portal token never opens the staff API.

export const PORTAL_SECRET = () => process.env.PORTAL_JWT_SECRET ?? 'change-me-portal-in-production'

const MAX_ATTEMPTS = 5
const LOCK_MINUTES = 15
const IP_WINDOW_MS = 60_000
const IP_MAX = 20

export interface PortalToken { sub: string; tv: number }

@Injectable()
export class PortalAuthService {
  private readonly hits = new Map<string, number[]>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt:    JwtService,
  ) {}

  async login(raw: unknown, ip: string): Promise<PortalLoginResult> {
    this.throttle(ip)
    const dto = portalLoginSchema.parse(raw)
    const invalid = new UnauthorizedException('Matrícula ou PIN inválido')
    const employee = await this.prisma.employee.findUnique({
      where:  { code: dto.code },
      select: { status: true, taxId: true, crewMember: { select: { id: true, access: true } } },
    })
    const member = employee?.crewMember
    if (!employee || !member || employee.status !== 'ACTIVE') throw invalid

    // no access yet: the first PIN, checked against the CPF
    let access = member.access
    if (!access) {
      if (dto.pin !== initialPin(employee.taxId)) throw invalid
      access = await this.prisma.crewAccess.create({ data: { crewMemberId: member.id, pinHash: await argon2.hash(dto.pin) } })
    }
    if (access.lockedUntil && access.lockedUntil > new Date()) {
      throw new HttpException(`Acesso bloqueado por tentativas erradas — tente depois de ${access.lockedUntil.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`, HttpStatus.TOO_MANY_REQUESTS)
    }
    if (!(await argon2.verify(access.pinHash, dto.pin))) {
      const failed = access.failedAttempts + 1
      await this.prisma.crewAccess.update({
        where: { id: access.id },
        data:  failed >= MAX_ATTEMPTS ? { failedAttempts: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) } : { failedAttempts: failed },
      })
      throw invalid
    }
    await this.prisma.crewAccess.update({ where: { id: access.id }, data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() } })
    const payload: PortalToken = { sub: member.id, tv: access.tokenVersion }
    return { token: await this.jwt.signAsync(payload, { secret: PORTAL_SECRET(), expiresIn: '30d' }), mustChangePin: access.mustChangePin }
  }

  async changePin(crewMemberId: string, raw: unknown): Promise<void> {
    const dto = portalChangePinSchema.parse(raw)
    const access = await this.prisma.crewAccess.findUnique({ where: { crewMemberId } })
    if (!access || !(await argon2.verify(access.pinHash, dto.current))) throw new BadRequestException('PIN atual incorreto')
    await this.prisma.crewAccess.update({ where: { id: access.id }, data: { pinHash: await argon2.hash(dto.next), mustChangePin: false } })
  }

  // staff: back to the first PIN (CPF), to be changed at the next login; older tokens stop working
  async resetPin(crewMemberId: string): Promise<void> {
    const member = await this.prisma.crewMember.findUnique({ where: { id: crewMemberId }, select: { employee: { select: { taxId: true } } } })
    if (!member) throw new NotFoundException('Operador não encontrado')
    const pinHash = await argon2.hash(initialPin(member.employee.taxId))
    await this.prisma.crewAccess.upsert({
      where:  { crewMemberId },
      create: { crewMemberId, pinHash },
      update: { pinHash, mustChangePin: true, failedAttempts: 0, lockedUntil: null, tokenVersion: { increment: 1 } },
    })
  }

  private throttle(ip: string): void {
    const now = Date.now()
    const recent = (this.hits.get(ip) ?? []).filter(t => now - t < IP_WINDOW_MS)
    if (recent.length >= IP_MAX) throw new HttpException('Muitas tentativas — aguarde um minuto', HttpStatus.TOO_MANY_REQUESTS)
    recent.push(now)
    this.hits.set(ip, recent)
  }
}

// the first 6 digits of the CPF
function initialPin(taxId: string): string {
  const digits = taxId.replace(/\D/g, '')
  if (digits.length < 6) throw new BadRequestException('CPF do funcionário inválido — não há PIN inicial')
  return digits.slice(0, 6)
}
