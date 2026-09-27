-- Plans that were in force and got replaced used to go back to DRAFT keeping their dates;
-- they become SUPERSEDED. A window left empty (activated and replaced on the same day)
-- never was in force: plain DRAFT without dates.

UPDATE "transit_vehicle_plans" SET "validFrom" = NULL, "validTo" = NULL
 WHERE "status" = 'DRAFT' AND "validTo" IS NOT NULL AND "validTo" < "validFrom";
UPDATE "transit_vehicle_plans" SET "status" = 'SUPERSEDED'
 WHERE "status" = 'DRAFT' AND "validTo" IS NOT NULL;

UPDATE "transit_crew_plans" SET "validFrom" = NULL, "validTo" = NULL
 WHERE "status" = 'DRAFT' AND "validTo" IS NOT NULL AND "validTo" < "validFrom";
UPDATE "transit_crew_plans" SET "status" = 'SUPERSEDED'
 WHERE "status" = 'DRAFT' AND "validTo" IS NOT NULL;
