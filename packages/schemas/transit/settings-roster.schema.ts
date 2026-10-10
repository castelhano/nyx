import { z } from 'zod'
import { withMeta } from '../with-meta'

// The real roster's rules of one empresa (Settings scope 'branch', falling back to global).
// The rest between duties is a CCT rule — it lives in the crew settings (per transit Scope).
// More fields join when the roster generator consumes them (docs/proposal/brainchild/
// plan_crew_rostering_impl_v2.md §2.8).
export const rosterSettingsSchema = withMeta(z.object({
  // what CrewMemberLine.access means: WHITELIST — a crew member only operates his ENABLED
  // lines; BLACKLIST — every line but his BLOCKED ones
  lineAccessMode:    z.enum(['WHITELIST', 'BLACKLIST']).default('BLACKLIST'),
  // preferred lines per crew member (CrewMemberLine.rank 1..n)
  maxPreferredLines: z.number().int().min(0).max(10).default(3),
  // weekly hours when neither the crew member nor his contract set them (monthly = weekly × 5)
  defaultWeeklyHours: z.number().int().min(1).max(44).default(42),
}), {
  // Served by the custom `transit/settings` page — must not show up as its own resource in the
  // sidebar/discovery.
  label:  'Configurações de Escala Real',
  hidden: true,
})

export type RosterSettings = z.infer<typeof rosterSettingsSchema>

export const LINE_ACCESS_MODE_LABEL: Record<RosterSettings['lineAccessMode'], string> = {
  WHITELIST: 'Habilitadas — o condutor só opera as linhas habilitadas para ele',
  BLACKLIST: 'Bloqueadas — o condutor opera todas, menos as bloqueadas para ele',
}
