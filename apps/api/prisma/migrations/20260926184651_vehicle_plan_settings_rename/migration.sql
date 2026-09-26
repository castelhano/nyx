-- Rename VehiclePlan.metrics → settings (per-plan override of the planning config).
-- RENAME keeps existing data, unlike the DROP/ADD Prisma generates by default.
ALTER TABLE "transit_vehicle_plans" RENAME COLUMN "metrics" TO "settings";
