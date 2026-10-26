import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { PrismaService } from '../../../prisma/prisma.service'
import { PORTAL_SECRET, type PortalToken } from './portal-auth.service'
import { syncNotifications } from './portal-notifications'

// Every portal request: a portal token whose version still holds, from an active employee. Until
// the PIN is changed only the routes marked 'pin' answer; with unread notifications, only the
// ones marked 'notifications' (and 'pin') — the lock is in the API, not only on the screen.

export type PortalOpen = 'always' | 'pin' | 'notifications'
export const OPEN_KEY = 'portal-open'
export const PortalOpenFor = (open: PortalOpen) => SetMetadata(OPEN_KEY, open)

export interface PortalCrew { id: string; branchId: string; role: string; mustChangePin: boolean }
export type PortalRequest = { headers: Record<string, string | undefined>; crew?: PortalCrew }

@Injectable()
export class PortalGuard implements CanActivate {
  constructor(
    private readonly prisma:    PrismaService,
    private readonly jwt:       JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<PortalRequest>()
    const header = req.headers.authorization ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    let payload: PortalToken
    try {
      payload = await this.jwt.verifyAsync<PortalToken>(token, { secret: PORTAL_SECRET() })
    } catch {
      throw new UnauthorizedException('Sessão expirada — entre de novo')
    }
    const member = await this.prisma.crewMember.findUnique({
      where:  { id: payload.sub },
      select: { id: true, role: true, access: true, employee: { select: { status: true, branchId: true } } },
    })
    if (!member?.access || member.access.tokenVersion !== payload.tv || member.employee.status !== 'ACTIVE') {
      throw new UnauthorizedException('Sessão expirada — entre de novo')
    }
    req.crew = { id: member.id, branchId: member.employee.branchId, role: member.role, mustChangePin: member.access.mustChangePin }

    const open = this.reflector.get<PortalOpen | undefined>(OPEN_KEY, context.getHandler())
    if (open === 'always') return true
    if (member.access.mustChangePin) {
      if (open === 'pin') return true
      throw new ForbiddenException('Troque o PIN para continuar')
    }
    if (open === 'pin' || open === 'notifications') return true
    await syncNotifications(this.prisma, member.id, member.access.createdAt)
    const unread = await this.prisma.crewNotification.count({ where: { crewMemberId: member.id, readAt: null } })
    if (unread) throw new ForbiddenException('Confirme as mudanças na sua escala para continuar')
    return true
  }
}
