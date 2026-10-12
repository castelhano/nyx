import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

// Férias — CrewOccurrences of the system type VACATION, launched and listed on their own screen
// (transit/vacation). Registered only for discovery / CASL, like the DOP: no model of its own.
export const vacationSchema = withMeta(
  z.object({
    id: z.uuid(),
  }),
  {
    label:       'Férias',
    labelPlural: 'Férias',
    nameField:   'id',
    icon:        'TreePalm',
    isSingleton: true,
  },
)
export type Vacation = z.infer<typeof vacationSchema>

// one launch — several crew members in the same period; a ferista only with a single one
export const vacationLaunchSchema = z.object({
  crewMemberIds:     z.array(z.uuid()).min(1, 'Informe ao menos um operador'),
  startDate:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  coverCrewMemberId: z.uuid().nullable().optional(),
  notes:             z.string().optional(),
})
export type VacationLaunch = z.infer<typeof vacationLaunchSchema>

export interface VacationRow {
  id:        string
  startDate: string
  endDate:   string
  status:    string
  notes:     string | null
  crewMember: { id: string; code: string; name: string; branchId: string }
  cover:      { id: string; code: string; name: string } | null
}

// what a launch would bring up — alerts don't stop it, `blocked` does
export interface VacationCheck {
  warnings: string[]
  blocked:  string[]
}

// what a launch did to the days already generated
export interface VacationRelease {
  // duties taken from the crew member on vacation
  released: number
  // of those, handed to the ferista
  covered:  number
}
