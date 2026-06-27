import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { PrismaLibSql } from '@prisma/adapter-libsql'
import { PrismaPg } from '@prisma/adapter-pg'

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const url = process.env.DATABASE_URL!
    const isPostgres = url.startsWith('postgresql://') || url.startsWith('postgres://')
    super({ adapter: isPostgres ? new PrismaPg({ connectionString: url }) : new PrismaLibSql({ url }) })
  }

  async onModuleInit()    { await this.$connect()    }
  async onModuleDestroy() { await this.$disconnect() }
}
