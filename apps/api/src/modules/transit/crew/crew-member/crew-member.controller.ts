import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { CrewMember, CreateCrewMemberDto, UpdateCrewMemberDto } from '@nyx/schemas'
import { BaseController } from '../../../../core/base.controller'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { CrewMemberService } from './crew-member.service'

@Controller('transit/crew-member')
@UseGuards(JwtAuthGuard)
export class CrewMemberController extends BaseController<CrewMember, CreateCrewMemberDto, UpdateCrewMemberDto> {
  constructor(
    private readonly crewMemberService: CrewMemberService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(crewMemberService, caslFactory)
  }

  // must be defined before :id routes so NestJS matches static segments first
  @Get('suggest-role')
  async suggestRole(@Query('employeeId') employeeId?: string) {
    if (!employeeId) return {}
    const role = await this.crewMemberService.suggestRole(employeeId)
    return role ? { role } : {}
  }
}
