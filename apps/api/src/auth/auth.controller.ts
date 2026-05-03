import { Controller, Post, Body, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcrypt'
import { z } from 'zod'
import { UserService } from '../modules/identity/user/user.service'

const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
})

@Controller('auth')
export class AuthController {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService:  JwtService,
  ) {}

  @Post('login')
  async login(@Body() body: unknown) {
    const { username, password } = loginSchema.parse(body)
    const user = await this.userService.findByUsername(username)
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials')
    }
    const payload = { sub: user.id, username: user.username, role: user.role }
    return { accessToken: this.jwtService.sign(payload) }
  }
}
