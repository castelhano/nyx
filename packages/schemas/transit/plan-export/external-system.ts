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
// feed (docs/architecture/transit/gtfs-export.md), not a plan layout.
export const EXTERNAL_CODE_SYSTEMS = ['GLOBUS', 'GOAL'] as const
export type ExternalCodeSystem = typeof EXTERNAL_CODE_SYSTEMS[number]

export const EXTERNAL_CODE_SYSTEM_LABEL: Record<ExternalCodeSystem, string> = {
  GLOBUS: 'Globus',
  GOAL:   'Goal',
}

const EXTERNAL_CODES_META = {
  label:          'Códigos Externos',
  widget:         'object-editor',
  importFlatten:  true,   // CSV import: one column per system (externalCodes.GLOBUS)
  showInForm:     true,
  listVisibility: 'never',
} as const

const globusCode = z.string().max(20).optional().meta({ label: EXTERNAL_CODE_SYSTEM_LABEL.GLOBUS })

// Per-system code of a record (TransitLocality, TransitLine) — one key per system, so the
// object-editor renders one input each and no key is ever typed by hand. Blank falls back
// to the record's own `code`.
export const externalCodesSchema = z.object({ GLOBUS: globusCode }).optional().meta(EXTERNAL_CODES_META)

// Lines and localities also map to Goal: a line's code is the GTFS route_id; a locality's is
// used by the idle matrix for depots (docs/architecture/transit/osrm.md). The GTFS stop_id is
// always the nyx code.
export const transitExternalCodesSchema = z.object({
  GLOBUS: globusCode,
  GOAL:   z.string().max(20).optional().meta({ label: EXTERNAL_CODE_SYSTEM_LABEL.GOAL }),
}).optional().meta(EXTERNAL_CODES_META)

export type ExternalCodes = z.infer<typeof externalCodesSchema>

export function resolveExternalCode(
  record: { code: string; externalCodes?: unknown },
  system: ExternalCodeSystem,
): { code: string; fallback: boolean } {
  const mapped = (record.externalCodes as Partial<Record<ExternalCodeSystem, string>> | null | undefined)?.[system]?.trim()
  return mapped ? { code: mapped, fallback: false } : { code: record.code, fallback: true }
}
