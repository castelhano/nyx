import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { PassportModule } from '@nestjs/passport'
import { JwtStrategy } from './jwt.strategy'
import { CaslAbilityFactory } from './casl.factory'
import { AuthController } from './auth.controller'
import { UserModule } from '../modules/identity/user/user.module'

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret:       process.env.JWT_SECRET ?? 'change-me-in-production',
      signOptions:  { expiresIn: '7d' },
    }),
    UserModule,
  ],
  controllers: [AuthController],
  providers:   [JwtStrategy, CaslAbilityFactory],
  exports:     [CaslAbilityFactory, JwtModule],
})
export class AuthModule {}
