import { z } from 'zod'

// Every fleet.VehicleType (apps/api/prisma/schema/fleet.prisma) — the trip/departure schemas
// still accept only a subset for requiredVehicleType.
export const VEHICLE_TYPES = ['STANDARD', 'ARTICULATED', 'BI_ARTICULATED', 'MICRO_BUS', 'MINIBUS', 'VAN'] as const

export const vehicleTypeSchema = z.enum(VEHICLE_TYPES)
export type VehicleTypeValue = z.infer<typeof vehicleTypeSchema>

export const VEHICLE_TYPE_LABELS: Record<VehicleTypeValue, string> = {
  STANDARD:       'Convencional',
  ARTICULATED:    'Articulado',
  BI_ARTICULATED: 'Biarticulado',
  MICRO_BUS:      'Micro-ônibus',
  MINIBUS:        'Miniônibus',
  VAN:            'Van',
}
