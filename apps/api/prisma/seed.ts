import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcrypt'

const prisma = new PrismaClient()

async function main() {
  const existing = await prisma.user.findUnique({ where: { username: 'admin' } })
  if (existing) {
    console.log('Admin user already exists, skipping.')
    return
  }

  const passwordHash = await bcrypt.hash('admin123', 10)
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
