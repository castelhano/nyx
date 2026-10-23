import { Injectable, BadRequestException } from '@nestjs/common'
import * as argon2 from 'argon2'
import type { Prisma } from '@prisma/client'
import { userSchema, User, CreateUserDto, UpdateUserDto } from '@nyx/schemas'
import { PrismaService } from '../../../prisma/prisma.service'
import { BaseService } from '../../../core/base.service'
import { stringContains } from '../../../core/db.utils'
import type { ImportOp } from '../../../core/import/import.engine'
import { PasswordPolicyService } from '../settings/password-policy/password-policy.service'

@Injectable()
export class UserService extends BaseService<User, CreateUserDto, UpdateUserDto> {
  constructor(
    prisma: PrismaService,
    private readonly passwordPolicy: PasswordPolicyService,
  ) {
    super(prisma, 'user', userSchema, 'core')
  }

  private sanitize(user: User): User {
    const { passwordHash: _, ...safe } = user
    return safe as User
  }

  findByUsername(username: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { username } })
  }

  async findAll(query: import('@nyx/types').PaginationQuery) {
    const result = await super.findAll(query)
    return { ...result, data: result.data.map(u => this.sanitize(u)) }
  }

  async findOne(id: string): Promise<User> {
    return this.sanitize(await super.findOne(id))
  }

  async create(dto: CreateUserDto): Promise<User> {
    const { password, ...rest } = dto
    const passwordHash = await argon2.hash(password)
    const user = await this.prisma.user.create({
      data: { ...rest, passwordHash, forcePasswordChange: rest.forcePasswordChange ?? true },
    }) as User
    await this.passwordPolicy.recordHistory(user.id, passwordHash)
    return this.sanitize(user)
  }

  async update(id: string, dto: UpdateUserDto): Promise<User> {
    return this.sanitize(await super.update(id, dto))
  }

  async deactivate(id: string): Promise<User> {
    await super.findOne(id)
    const user = await this.prisma.user.update({ where: { id }, data: { isActive: false } }) as User
    return this.sanitize(user)
  }

  async changePassword(id: string, dto: { currentPassword: string; newPassword: string }): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id } }) as User
    const valid = await argon2.verify(user.passwordHash, dto.currentPassword)
    if (!valid) throw new BadRequestException('Senha atual incorreta')
    await this.passwordPolicy.validate(dto.newPassword, id)
    const passwordHash = await argon2.hash(dto.newPassword)
    await this.prisma.user.update({ where: { id }, data: { passwordHash, forcePasswordChange: false } })
    await this.passwordPolicy.recordHistory(id, passwordHash)
  }

  async resetPassword(id: string, newPassword: string): Promise<void> {
    await this.passwordPolicy.validate(newPassword, id)
    const passwordHash = await argon2.hash(newPassword)
    await this.prisma.user.update({ where: { id }, data: { passwordHash, forcePasswordChange: true } })
    await this.passwordPolicy.recordHistory(id, passwordHash)
  }

  // CSV import (importFields in the schema): a new user gets the temporary password, which must be
  // changed on first login, its branches as member and a copy of permissionsFrom's permissions.
  // An existing user keeps password and permissions; a filled `branches` cell sets its branches,
  // keeping the role of those it already had.
  protected override async importWrite(tx: Prisma.TransactionClient, op: ImportOp): Promise<void> {
    const { password, branches, permissionsFrom } = op.extra as { password?: string; branches?: string[]; permissionsFrom?: string }

    if (op.action === 'update') {
      await tx.user.update({ where: { id: op.id }, data: op.data })
      if (branches) {
        await tx.userBranch.deleteMany({ where: { userId: op.id, branchId: { notIn: branches } } })
        await tx.userBranch.createMany({ data: branches.map(branchId => ({ userId: op.id!, branchId })), skipDuplicates: true })
      }
      return
    }

    const passwordHash = await argon2.hash(password!)
    const user = await tx.user.create({
      data: { ...(op.data as Prisma.UserCreateInput), passwordHash, forcePasswordChange: true },
    })
    await this.passwordPolicy.recordHistory(user.id, passwordHash, tx)
    if (branches?.length) {
      await tx.userBranch.createMany({ data: branches.map(branchId => ({ userId: user.id, branchId, role: 'member' as const })) })
    }
    if (permissionsFrom) {
      const permissions = await tx.userPermission.findMany({ where: { userId: permissionsFrom }, select: { resource: true, action: true } })
      await tx.userPermission.createMany({ data: permissions.map(p => ({ ...p, userId: user.id })) })
    }
  }

  protected buildSearchWhere(search: string) {
    return {
      OR: [
        { name:     stringContains(search) },
        { username: stringContains(search) },
      ],
    }
  }
}
