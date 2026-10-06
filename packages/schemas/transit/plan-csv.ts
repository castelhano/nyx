// CSV export of a vehicle plan (carros) or a crew plan (tabelas) — the layouts are built by
// the API (plan-csv module), the client only writes the file (lib/csv.ts downloadCsvRows).
export const PLAN_CSV_MODELS = ['DETAILED', 'SUMMARY'] as const
export type PlanCsvModel = typeof PLAN_CSV_MODELS[number]

export const PLAN_CSV_MODEL_LABEL: Record<PlanCsvModel, string> = {
  DETAILED: 'M1 Detalhado',
  SUMMARY:  'M2 Resumo',
}

export interface PlanCsvFile {
  filename: string
  headers:  string[]
  rows:     (string | number)[][]
}
