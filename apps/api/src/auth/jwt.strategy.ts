import { Injectable } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import type { AuthUser } from '@nyx/types'

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest:   ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:      process.env.JWT_SECRET ?? 'change-me-in-production',
    })
  }

  validate(payload: { sub: string; role: string; branchIds: string[] }): Promise<AuthUser> {
    return Promise.resolve({ id: payload.sub, role: payload.role, branchIds: payload.branchIds ?? [] })
  }
}
