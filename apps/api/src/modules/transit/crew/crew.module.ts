import { Module } from '@nestjs/common'
import { CaslModule } from '../../../auth/casl.module'
import { TransitSettingsModule } from '../settings/transit-settings.module'
import { RestPatternController } from './rest-pattern/rest-pattern.controller'
import { RestPatternService } from './rest-pattern/rest-pattern.service'
import { CrewAbsenceTypeController } from './crew-absence-type/crew-absence-type.controller'
import { CrewAbsenceTypeService } from './crew-absence-type/crew-absence-type.service'
import { CrewMemberController } from './crew-member/crew-member.controller'
import { CrewMemberService } from './crew-member/crew-member.service'
import { CrewMemberShiftController } from './crew-member/crew-member-shift.controller'
import { CrewMemberShiftService } from './crew-member/crew-member-shift.service'
import { CrewMemberLineController } from './crew-member/crew-member-line.controller'
import { CrewMemberLineService } from './crew-member/crew-member-line.service'
import { CrewOccurrenceController } from './crew-member/crew-occurrence.controller'
import { CrewOccurrenceService } from './crew-member/crew-occurrence.service'

// Crew members' operational profile — the real roster's master data
@Module({
  imports:     [CaslModule, TransitSettingsModule],
  controllers: [RestPatternController, CrewAbsenceTypeController, CrewMemberController, CrewMemberShiftController, CrewMemberLineController, CrewOccurrenceController],
  providers:   [RestPatternService, CrewAbsenceTypeService, CrewMemberService, CrewMemberShiftService, CrewMemberLineService, CrewOccurrenceService],
  exports:     [CrewMemberService, CrewMemberShiftService],
})
export class CrewModule {}
