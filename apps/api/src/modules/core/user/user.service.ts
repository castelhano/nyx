import { Injectable } from '@nestjs/common'
import * as bcrypt from 'bcrypt'
import { userSchema, User, CreateUserDto, UpdateUserDto } from '@nyx/schemas'
import { PrismaService } from '../../../prisma/prisma.service'
import { BaseService } from '../../../core/base.service'
import { stringContains } from '../../../core/db.utils'
import { PasswordPolicyService } from '../../settings/password-policy/password-policy.service'

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
    return this.prisma.user.findUnique({ where: { username } }) as Promise<User | null>
  }

  async findAll(query: import('@nyx/types').PaginationQuery) {
    const result = await super.findAll(query)
    return { ...result, data: result.data.map(this.sanitize) }
  }

  async findOne(id: string): Promise<User> {
    return this.sanitize(await super.findOne(id))
  }

  async create(dto: CreateUserDto): Promise<User> {
    const { password, ...rest } = dto
    await this.passwordPolicy.validate(password)
    const passwordHash = await bcrypt.hash(password, 10)
    const user = await this.prisma.user.create({ data: { ...rest, passwordHash } }) as User
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
    const valid = await bcrypt.compare(dto.currentPassword, user.passwordHash)
    if (!valid) throw new Error('Invalid current password')
    await this.passwordPolicy.validate(dto.newPassword, id)
    const passwordHash = await bcrypt.hash(dto.newPassword, 10)
    await this.prisma.user.update({ where: { id }, data: { passwordHash } })
    await this.passwordPolicy.recordHistory(id, passwordHash)
  }

  async resetPassword(id: string, newPassword: string): Promise<void> {
    await this.passwordPolicy.validate(newPassword, id)
    const passwordHash = await bcrypt.hash(newPassword, 10)
    await this.prisma.user.update({ where: { id }, data: { passwordHash } })
    await this.passwordPolicy.recordHistory(id, passwordHash)
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
