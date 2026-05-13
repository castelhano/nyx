import { Module } from '@nestjs/common'
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core'
import { PrismaModule } from './prisma/prisma.module'
import { AuthModule } from './auth/auth.module'
import { CoreModule } from './modules/core/core.module'
import { SettingsModule } from './modules/settings/settings.module'
import { DiscoveryModule } from './modules/discovery/discovery.module'
import { AllExceptionsFilter } from './core/exception.filter'
import { PaginationInterceptor } from './core/pagination.interceptor'

@Module({
  imports: [PrismaModule, AuthModule, CoreModule, SettingsModule, DiscoveryModule],
  providers: [
    { provide: APP_FILTER,      useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: PaginationInterceptor },
  ],
})
export class AppModule {}
