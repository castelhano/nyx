-- CreateEnum
CREATE TYPE "CrewAbsenceEffect" AS ENUM ('ABSENCE', 'DAY_OFF', 'COMP_OFF');

-- AlterTable
ALTER TABLE "transit_crew_absence_types" ADD COLUMN     "effect" "CrewAbsenceEffect" NOT NULL DEFAULT 'ABSENCE',
ADD COLUMN     "externalCodes" JSONB,
ADD COLUMN     "systemKey" TEXT;

-- AlterTable
ALTER TABLE "transit_roster_entries" ADD COLUMN     "absenceTypeId" TEXT,
ADD COLUMN     "crewOccurrenceId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "transit_crew_absence_types_systemKey_key" ON "transit_crew_absence_types"("systemKey");

-- AddForeignKey
ALTER TABLE "transit_roster_entries" ADD CONSTRAINT "transit_roster_entries_absenceTypeId_fkey" FOREIGN KEY ("absenceTypeId") REFERENCES "transit_crew_absence_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_roster_entries" ADD CONSTRAINT "transit_roster_entries_crewOccurrenceId_fkey" FOREIGN KEY ("crewOccurrenceId") REFERENCES "transit_crew_occurrences"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The roster's own days off become system absence types (an existing type with the same code is adopted)
INSERT INTO "transit_crew_absence_types" ("id", "code", "name", "requestable", "isActive", "effect", "systemKey", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'FS', 'Folga semanal (DSR)', false, true, 'DAY_OFF',  'WEEKLY_OFF', now(), now()),
  (gen_random_uuid(), 'FC', 'Folga compensada',    false, true, 'COMP_OFF', 'COMP_OFF',   now(), now())
ON CONFLICT ("code") DO UPDATE SET "effect" = EXCLUDED."effect", "systemKey" = EXCLUDED."systemKey";

-- existing days off take them
UPDATE "transit_roster_entries" e SET "absenceTypeId" = t."id"
FROM "transit_crew_absence_types" t
WHERE e."absenceTypeId" IS NULL
  AND ((e."kind" = 'DAY_OFF' AND t."systemKey" = 'WEEKLY_OFF') OR (e."kind" = 'COMP_OFF' AND t."systemKey" = 'COMP_OFF'));
