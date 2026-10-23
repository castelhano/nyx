import { Injectable, BadRequestException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import * as argon2 from 'argon2'
import { passwordPolicySchema } from '@nyx/schemas'
import type { PasswordPolicy } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseSettingsService } from '../../../../core/base-settings.service'

@Injectable()
export class PasswordPolicyService extends BaseSettingsService<PasswordPolicy> {
  constructor(prisma: PrismaService) {
    super(prisma, 'password-policy', 'core', passwordPolicySchema, 'global')
  }

  async validate(password: string, userId?: string): Promise<void> {
    const policy = await this.get()
    const errors: string[] = []

    if (password.length < policy.minLength)
      errors.push(`A senha deve ter pelo menos ${policy.minLength} caracteres`)
    if (policy.requireUppercase && !/[A-Z]/.test(password))
      errors.push('A senha deve conter pelo menos uma letra maiúscula')
    if (policy.requireNumbers && !/[0-9]/.test(password))
      errors.push('A senha deve conter pelo menos um número')
    if (policy.requireSpecial && !/[^A-Za-z0-9]/.test(password))
      errors.push('A senha deve conter pelo menos um caractere especial')

    if (userId && policy.historyCount > 0) {
      const history = await this.prisma.userPasswordHistory.findMany({
        where:   { userId },
        orderBy: { createdAt: 'desc' },
        take:    policy.historyCount,
      })
      for (const entry of history) {
        if (await argon2.verify(entry.passwordHash, password)) {
          errors.push(`A senha não pode ser igual às últimas ${policy.historyCount} senhas utilizadas`)
          break
        }
      }
    }

    if (errors.length > 0) throw new BadRequestException(errors)
  }

  // db: a transaction's client when the user was just created inside it (the CSV import)
  async recordHistory(userId: string, passwordHash: string, db: Prisma.TransactionClient = this.prisma): Promise<void> {
    const policy = await this.get()
    if (policy.historyCount === 0) return

    await db.userPasswordHistory.create({ data: { userId, passwordHash } })

    const all = await db.userPasswordHistory.findMany({
      where:   { userId },
      orderBy: { createdAt: 'desc' },
      select:  { id: true },
    })
    const toDelete = all.slice(policy.historyCount).map((r) => r.id)
    if (toDelete.length > 0) {
      await db.userPasswordHistory.deleteMany({ where: { id: { in: toDelete } } })
    }
  }
}
