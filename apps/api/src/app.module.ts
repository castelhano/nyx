import { Module } from '@nestjs/common'
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core'
import { PrismaModule } from './prisma/prisma.module'
import { AuthModule } from './auth/auth.module'
import { IdentityModule } from './modules/identity/identity.module'
import { CrmModule } from './modules/crm/crm.module'
import { AllExceptionsFilter } from './core/exception.filter'
import { PaginationInterceptor } from './core/pagination.interceptor'

@Module({
  imports: [PrismaModule, AuthModule, IdentityModule, CrmModule],
  providers: [
    { provide: APP_FILTER,      useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: PaginationInterceptor },
  ],
})
export class AppModule {}
