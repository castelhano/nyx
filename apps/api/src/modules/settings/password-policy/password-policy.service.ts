import { Injectable, BadRequestException } from '@nestjs/common'
import * as bcrypt from 'bcrypt'
import { UpsertPasswordPolicyDto, PasswordPolicy } from '@nyx/schemas'
import { PrismaService } from '../../../prisma/prisma.service'

@Injectable()
export class PasswordPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async findCurrent(): Promise<PasswordPolicy | null> {
    return this.prisma.passwordPolicy.findFirst() as Promise<PasswordPolicy | null>
  }

  async upsert(dto: UpsertPasswordPolicyDto): Promise<PasswordPolicy> {
    const current = await this.prisma.passwordPolicy.findFirst()

    if (current) {
      return this.prisma.passwordPolicy.update({
        where: { id: current.id },
        data:  dto,
      }) as Promise<PasswordPolicy>
    }

    return this.prisma.passwordPolicy.create({ data: dto }) as Promise<PasswordPolicy>
  }

  // Valida a senha contra a política vigente e o histórico do usuário.
  // Lança BadRequestException com as mensagens de erro acumuladas.
  async validate(password: string, userId?: string): Promise<void> {
    const policy = await this.findCurrent()
    if (!policy) return

    const errors: string[] = []

    if (password.length < policy.minLength) {
      errors.push(`A senha deve ter pelo menos ${policy.minLength} caracteres`)
    }

    if (policy.requireUppercase && !/[A-Z]/.test(password)) {
      errors.push('A senha deve conter pelo menos uma letra maiúscula')
    }

    if (policy.requireNumbers && !/[0-9]/.test(password)) {
      errors.push('A senha deve conter pelo menos um número')
    }

    if (policy.requireSpecial && !/[^A-Za-z0-9]/.test(password)) {
      errors.push('A senha deve conter pelo menos um caractere especial')
    }

    if (userId && policy.historyCount > 0) {
      const history = await this.prisma.userPasswordHistory.findMany({
        where:   { userId },
        orderBy: { createdAt: 'desc' },
        take:    policy.historyCount,
      })

      for (const entry of history) {
        if (await bcrypt.compare(password, entry.passwordHash)) {
          errors.push(`A senha não pode ser igual às últimas ${policy.historyCount} senhas utilizadas`)
          break
        }
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException(errors)
    }
  }

  async recordHistory(userId: string, passwordHash: string): Promise<void> {
    const policy = await this.findCurrent()
    if (!policy || policy.historyCount === 0) return

    await this.prisma.userPasswordHistory.create({ data: { userId, passwordHash } })

    // mantém apenas os últimos N registros
    const all = await this.prisma.userPasswordHistory.findMany({
      where:   { userId },
      orderBy: { createdAt: 'desc' },
      select:  { id: true },
    })

    const toDelete = all.slice(policy.historyCount).map(r => r.id)
    if (toDelete.length > 0) {
      await this.prisma.userPasswordHistory.deleteMany({ where: { id: { in: toDelete } } })
    }
  }
}
