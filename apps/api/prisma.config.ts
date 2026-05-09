import 'dotenv/config'
import { defineConfig, env } from 'prisma/config'
import { PrismaLibSql } from '@prisma/adapter-libsql'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
  migrate: {
    async adapter() {
      const { PrismaLibSql: Adapter } = await import('@prisma/adapter-libsql')
      return new Adapter({ url: env('DATABASE_URL') })
    },
  },
})
