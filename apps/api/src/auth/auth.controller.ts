import { Controller, Post, Get, Patch, Body, Req, UnauthorizedException, UseGuards } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as argon2 from 'argon2'
import { z } from 'zod'
import { PrismaService } from '../prisma/prisma.service'
import { UserService } from '../modules/core/user/user.service'
import { JwtAuthGuard } from './policies.guard'
import type { AuthUser } from '@nyx/types'

const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
})

@Controller('auth')
export class AuthController {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService:  JwtService,
    private readonly prisma:      PrismaService,
  ) {}

  @Post('login')
  async login(@Body() body: unknown) {
    const { username, password } = loginSchema.parse(body)

    const user = await this.userService.findByUsername(username)
    if (!user || !(await argon2.verify(user.passwordHash, password))) {
      throw new UnauthorizedException('Invalid credentials')
    }

    const branches = await this.prisma.userBranch.findMany({
      where:  { userId: user.id },
      select: { branchId: true },
    })

    await this.prisma.user.update({
      where: { id: user.id },
      data:  { lastLoginAt: new Date() },
    })

    const payload = {
      sub:       user.id,
      username:  user.username,
      role:      user.role,
      branchIds: branches.map(b => b.branchId),
    }

    return { accessToken: this.jwtService.sign(payload) }
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@Req() req: { user: AuthUser }) {
    const user = await this.prisma.user.findUnique({
      where:  { id: req.user.id },
      select: { id: true, name: true, username: true, role: true, preferences: true, forcePasswordChange: true },
    })
    return { ...user, branchIds: req.user.branchIds }
  }

  @Patch('me/preferences')
  @UseGuards(JwtAuthGuard)
  async updatePreferences(@Req() req: { user: AuthUser }, @Body() body: Record<string, unknown>) {
    const current = await this.prisma.user.findUnique({
      where:  { id: req.user.id },
      select: { preferences: true },
    })
    const merged = { ...(current?.preferences as Record<string, unknown> ?? {}), ...body }
    await this.prisma.user.update({ where: { id: req.user.id }, data: { preferences: JSON.parse(JSON.stringify(merged)) } })
    return merged
  }
}
