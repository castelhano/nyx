import { Injectable } from '@nestjs/common'
import { userBranchSchema, UserBranch, CreateUserBranchDto, UpdateUserBranchDto } from '@nyx/schemas'
import { BranchUserRole } from '@prisma/client'
import { PrismaService } from '../../../prisma/prisma.service'
import { BaseService } from '../../../core/base.service'

@Injectable()
export class UserBranchService extends BaseService<UserBranch, CreateUserBranchDto, UpdateUserBranchDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'userBranch', userBranchSchema)
  }

  findByUser(userId: string): Promise<UserBranch[]> {
    return this.prisma.userBranch.findMany({
      where:   { userId },
      orderBy: { createdAt: 'asc' },
    }) as Promise<UserBranch[]>
  }

  findByBranch(branchId: string): Promise<UserBranch[]> {
    return this.prisma.userBranch.findMany({
      where:   { branchId },
      orderBy: { createdAt: 'asc' },
    }) as Promise<UserBranch[]>
  }

  // Substitui todos os vínculos do usuário atomicamente
  async setForUser(userId: string, entries: { branchId: string; role: string }[]): Promise<UserBranch[]> {
    await this.prisma.userBranch.deleteMany({ where: { userId } })

    if (entries.length === 0) return []

    await this.prisma.userBranch.createMany({
      data: entries.map(e => ({ userId, branchId: e.branchId, role: e.role as BranchUserRole })),
    })

    return this.findByUser(userId)
  }
}
