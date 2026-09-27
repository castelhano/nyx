-- Plan validity becomes date-only, end inclusive (docs/proposal/plan_activation_date_v1.md).
-- Timestamps are stored in UTC; the operation runs on America/Cuiaba local days.

-- AlterEnum
ALTER TYPE "CrewPlanStatus" ADD VALUE 'SUPERSEDED';

-- AlterEnum
ALTER TYPE "VehiclePlanStatus" ADD VALUE 'SUPERSEDED';

-- AlterTable — local date of the stored instant
ALTER TABLE "transit_crew_plans"
  ALTER COLUMN "validFrom" SET DATA TYPE DATE USING ("validFrom" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Cuiaba')::date,
  ALTER COLUMN "validTo"   SET DATA TYPE DATE USING ("validTo"   AT TIME ZONE 'UTC' AT TIME ZONE 'America/Cuiaba')::date;

ALTER TABLE "transit_line_schedules"
  ALTER COLUMN "validFrom" SET DATA TYPE DATE USING ("validFrom" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Cuiaba')::date,
  ALTER COLUMN "validTo"   SET DATA TYPE DATE USING ("validTo"   AT TIME ZONE 'UTC' AT TIME ZONE 'America/Cuiaba')::date;

ALTER TABLE "transit_vehicle_plans"
  ALTER COLUMN "validFrom" SET DATA TYPE DATE USING ("validFrom" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Cuiaba')::date,
  ALTER COLUMN "validTo"   SET DATA TYPE DATE USING ("validTo"   AT TIME ZONE 'UTC' AT TIME ZONE 'America/Cuiaba')::date;

-- validTo was the superseding instant, shared with the successor's validFrom; with an
-- inclusive end it becomes the day before
UPDATE "transit_crew_plans"     SET "validTo" = "validTo" - 1 WHERE "validTo" IS NOT NULL;
UPDATE "transit_line_schedules" SET "validTo" = "validTo" - 1 WHERE "validTo" IS NOT NULL;
UPDATE "transit_vehicle_plans"  SET "validTo" = "validTo" - 1 WHERE "validTo" IS NOT NULL;
