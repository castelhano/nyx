import type { ExternalSystem } from './external-system'

// Neutral shapes of a plan export (docs/proposal/plan_globus_export_v1.md). A system's
// profile fills the fields of its own layout; the preview UI and the formatter only read
// the layout, never a system-specific field name.

// program = repeated on every line of the program, table = on every line of the table
export type ExportFieldLevel = 'program' | 'table' | 'row'

export interface ExportLayoutField {
  field:     string
  label:     string
  size:      number
  pad:       ' ' | '0'
  align:     'L' | 'R'
  mask?:     'HH:MM'
  level:     ExportFieldLevel
  editable?: boolean
  required?: boolean
  // regex source the value must fully match (when not empty)
  pattern?:  string
  // the value must be unique among the tables of a program
  uniqueInProgram?: boolean
}

export interface ExportLayoutDef {
  layout:          ExportLayoutField[]
  // every field the target system accepts — the ones out of `layout` are shown dimmed
  availableFields: string[]
  // shown on the export tab, e.g. a prerequisite on the target system
  notice?:         string
}

export type ExportFields = Record<string, string>

export type ExportRowKind = 'TRIP' | 'DISPLACEMENT' | 'BREAK' | 'SHIFT_CHANGE' | 'RETURN' | 'END'

export interface ExportIssue {
  code:    string
  message: string
}

export interface ExportRow {
  kind:      ExportRowKind
  fields:    ExportFields
  // fields whose code fell back to the Nyx code (no external code mapped)
  fallback?: string[]
  issues?:   ExportIssue[]
}

export interface ExportTable {
  fields:    ExportFields
  rows:      ExportRow[]
  fallback?: string[]
  issues?:   ExportIssue[]
}

export interface ExportCarro {
  blockId:     string
  blockNumber: number
  // position in the line's OSO — what names the tables
  number:      number
  tables:      ExportTable[]
  issues?:     ExportIssue[]
}

export interface ExportProgram {
  lineId:   string
  lineCode: string
  fields:   ExportFields
  carros:   ExportCarro[]
  issues?:  ExportIssue[]
}

export interface ExportPreview {
  system:   ExternalSystem
  programs: ExportProgram[]
  issues:   ExportIssue[]
}

export interface ExportValidationError {
  program:  number
  carro?:   number
  table?:   number
  row?:     number
  field:    string
  message:  string
}

// GET /transit/vehicle-plan/:id/plan-export/options
export interface ExportOptions {
  crewPlans: { id: string; description: string | null; status: string }[]
  operators: { branchId: string; label: string }[]
  programs:  { lineId: string; lineCode: string; defaultCode: string }[]
  blocksWithoutOperator: number
}

// POST /transit/vehicle-plan/:id/plan-export/preview
export interface ExportPreviewRequest {
  system:       ExternalSystem
  crewPlanId:   string
  branchId:     string
  lineIds:      string[]
  programCodes: Record<string, string>
}
