-- TransitTrip is now owned by exactly one VehiclePlan (never shared across plans —
-- see VehiclePlanService.duplicate, which always creates fresh rows on clone).
-- Dev-only data, nothing to backfill: existing trips (and their BlockTrip rows,
-- cascaded) are wiped before the column becomes required.
DELETE FROM "transit_trips";

-- AlterTable
ALTER TABLE "transit_trips" ADD COLUMN     "vehiclePlanId" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "transit_trips" ADD CONSTRAINT "transit_trips_vehiclePlanId_fkey" FOREIGN KEY ("vehiclePlanId") REFERENCES "transit_vehicle_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
