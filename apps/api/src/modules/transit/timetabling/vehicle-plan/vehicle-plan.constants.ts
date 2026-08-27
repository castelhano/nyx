import type { VehicleType } from '@prisma/client'

// Capacidade de referência por tipo de veículo, usada para inferir oferta real
// por linha em VehiclePlanService.scorePlan(). Hardcoded por enquanto — migrar
// para uma tela de settings (fleet ou transit, a definir) quando o volume de
// tipos justificar.
export const VEHICLE_TYPE_CAPACITY: Record<VehicleType, number> = {
  STANDARD:       80,
  ARTICULATED:    120,
  BI_ARTICULATED: 160,
  MICRO_BUS:      30,
  MINIBUS:        20,
  VAN:            15,
}
