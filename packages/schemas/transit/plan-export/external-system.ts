import { z } from 'zod'
import '../../zod-meta'

// External systems a plan can be exported to (docs/proposal/plan_globus_export_v1.md). Fixed
// in code on purpose — adding a system means adding its layout and profile anyway.
export const EXTERNAL_SYSTEMS = ['GLOBUS'] as const
export type ExternalSystem = typeof EXTERNAL_SYSTEMS[number]

export const EXTERNAL_SYSTEM_LABEL: Record<ExternalSystem, string> = {
  GLOBUS: 'Globus',
}

// Per-system code of a record (TransitLocality, TransitLine) — one key per system, so the
// object-editor renders one input each and no key is ever typed by hand. Blank falls back
// to the record's own `code`.
export const externalCodesSchema = z.object({
  GLOBUS: z.string().max(20).optional().meta({ label: 'Globus' }),
}).optional().meta({
  label:          'Códigos Externos',
  widget:         'object-editor',
  showInForm:     true,
  listVisibility: 'never',
})

export type ExternalCodes = z.infer<typeof externalCodesSchema>

export function resolveExternalCode(
  record: { code: string; externalCodes?: unknown },
  system: ExternalSystem,
): { code: string; fallback: boolean } {
  const mapped = (record.externalCodes as Partial<Record<ExternalSystem, string>> | null | undefined)?.[system]?.trim()
  return mapped ? { code: mapped, fallback: false } : { code: record.code, fallback: true }
}
