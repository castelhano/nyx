import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { PassportModule } from '@nestjs/passport'
import { JwtStrategy } from './jwt.strategy'
import { CaslModule } from './casl.module'
import { AuthController } from './auth.controller'
import { UserModule } from '../modules/core/user/user.module'

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret:      process.env.JWT_SECRET ?? 'change-me-in-production',
      signOptions: { expiresIn: '7d' },
    }),
    UserModule,
    CaslModule,
  ],
  controllers: [AuthController],
  providers:   [JwtStrategy],
  exports:     [CaslModule, JwtModule],
})
export class AuthModule {}
