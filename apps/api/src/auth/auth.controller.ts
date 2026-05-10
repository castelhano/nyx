import { Controller, Post, Body, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcrypt'
import { z } from 'zod'
import { PrismaService } from '../prisma/prisma.service'
import { UserService } from '../modules/core/user/user.service'

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
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
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
      role:      user.role,
      branchIds: branches.map(b => b.branchId),
    }

    return { accessToken: this.jwtService.sign(payload) }
  }
}
