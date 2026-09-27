// Response of the activate/approve endpoints of VehiclePlan, CrewPlan and LineSchedule
// (docs/proposal/plan_activation_date_v1.md). Without `confirm` nothing is written — the
// same shape is the preview shown before confirming.

export interface PlanActivationRef {
  id:    string
  label: string
}

export interface PlanActivationPreview {
  startDate:  string
  // other versions cut to the day before the start (validTo, 'YYYY-MM-DD')
  superseded: (PlanActivationRef & { validTo: string })[]
  // other versions that would only start on/after it — back to draft
  reverted:   PlanActivationRef[]
  // VehiclePlan only: its crew plans follow the same cut
  crewSuperseded: (PlanActivationRef & { validTo: string })[]
  crewReverted:   PlanActivationRef[]
  warnings:   string[]
  applied:    boolean
}
