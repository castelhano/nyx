import { z } from 'zod'
import '../../zod-meta'

// External systems a plan can be exported to (docs/proposal/plan_globus_export_v1.md). Fixed
// in code on purpose — adding a system means adding its layout and profile anyway.
export const EXTERNAL_SYSTEMS = ['GLOBUS'] as const
export type ExternalSystem = typeof EXTERNAL_SYSTEMS[number]

export const EXTERNAL_SYSTEM_LABEL: Record<ExternalSystem, string> = {
  GLOBUS: 'Globus',
}

// Systems a record can hold a code for — wider than EXTERNAL_SYSTEMS: Goal receives a GTFS
// feed (docs/proposal/plan_gtfs_export_v2.md), not a plan layout.
export const EXTERNAL_CODE_SYSTEMS = ['GLOBUS', 'GOAL'] as const
export type ExternalCodeSystem = typeof EXTERNAL_CODE_SYSTEMS[number]

const EXTERNAL_CODES_META = {
  label:          'Códigos Externos',
  widget:         'object-editor',
  importFlatten:  true,   // CSV import: one column per system (externalCodes.GLOBUS)
  showInForm:     true,
  listVisibility: 'never',
} as const

const globusCode = z.string().max(20).optional().meta({ label: 'Globus' })

// Per-system code of a record (TransitLocality, TransitLine) — one key per system, so the
// object-editor renders one input each and no key is ever typed by hand. Blank falls back
// to the record's own `code`.
export const externalCodesSchema = z.object({ GLOBUS: globusCode }).optional().meta(EXTERNAL_CODES_META)

// Lines also map to Goal; localities don't, there the GTFS stop_id is always the nyx code
export const lineExternalCodesSchema = z.object({
  GLOBUS: globusCode,
  GOAL:   z.string().max(20).optional().meta({ label: 'Goal' }),
}).optional().meta(EXTERNAL_CODES_META)

export type ExternalCodes = z.infer<typeof externalCodesSchema>

export function resolveExternalCode(
  record: { code: string; externalCodes?: unknown },
  system: ExternalCodeSystem,
): { code: string; fallback: boolean } {
  const mapped = (record.externalCodes as Partial<Record<ExternalCodeSystem, string>> | null | undefined)?.[system]?.trim()
  return mapped ? { code: mapped, fallback: false } : { code: record.code, fallback: true }
}
