import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common'
import { UpsertPasswordPolicyDto } from '@nyx/schemas'
import { JwtAuthGuard } from '../../../auth/policies.guard'
import { PasswordPolicyService } from './password-policy.service'

@Controller('core/password-policy')
@UseGuards(JwtAuthGuard)
export class PasswordPolicyController {
  constructor(private readonly service: PasswordPolicyService) {}

  @Get()
  findCurrent() {
    return this.service.findCurrent()
  }

  @Put()
  upsert(@Body() dto: UpsertPasswordPolicyDto) {
    return this.service.upsert(dto)
  }
}
