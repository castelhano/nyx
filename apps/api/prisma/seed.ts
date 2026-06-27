import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaLibSql } from '@prisma/adapter-libsql'
import { PrismaPg } from '@prisma/adapter-pg'
import * as argon2 from 'argon2'

const url      = process.env.DATABASE_URL!
const adapter  = url.startsWith('postgresql://') || url.startsWith('postgres://')
  ? new PrismaPg({ connectionString: url })
  : new PrismaLibSql({ url })
const prisma   = new PrismaClient({ adapter })

async function main() {
  const existing = await prisma.user.findUnique({ where: { username: 'admin' } })
  if (existing) {
    console.log('Admin user already exists, skipping.')
    return
  }

  const passwordHash = await argon2.hash('admin123')
  await prisma.user.create({
    data: {
      name:         'Admin',
      username:     'admin',
      passwordHash,
      role:         'admin',
      isActive:     true,
    },
  })

  console.log('Admin user created. Username: admin / Password: admin123')
  console.log('Change the password after first login.')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
