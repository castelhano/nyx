-- CreateEnum
CREATE TYPE "OvertimePreference" AS ENUM ('LIKES', 'NEUTRAL', 'AVOIDS');

-- CreateEnum
CREATE TYPE "CrewLineAccess" AS ENUM ('ENABLED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "CrewOccurrenceKind" AS ENUM ('ABSENCE', 'TIME_WINDOW');

-- CreateEnum
CREATE TYPE "CrewOccurrenceStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CrewOccurrenceOrigin" AS ENUM ('PORTAL', 'STAFF_ON_BEHALF', 'STAFF');

-- AlterTable
ALTER TABLE "transit_crew_shifts" ADD COLUMN     "restPatternId" TEXT;

-- CreateTable
CREATE TABLE "holidays" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "branchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_rest_patterns" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "anchorDate" DATE NOT NULL,
    "offOnHolidays" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_rest_patterns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_crew_members" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "role" "CrewRole" NOT NULL DEFAULT 'DRIVER',
    "isRosterable" BOOLEAN NOT NULL DEFAULT true,
    "notBeforeMinutes" INTEGER,
    "notAfterMinutes" INTEGER,
    "restPatternId" TEXT,
    "restOffset" INTEGER NOT NULL DEFAULT 0,
    "blockedVehicleTypes" "VehicleType"[] DEFAULT ARRAY[]::"VehicleType"[],
    "preferredVehicleId" TEXT,
    "weeklyHours" INTEGER,
    "licenseCategory" TEXT,
    "licenseExpiresAt" DATE,
    "courseExpiresAt" DATE,
    "overtimePreference" "OvertimePreference" NOT NULL DEFAULT 'NEUTRAL',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_crew_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_crew_member_shifts" (
    "id" TEXT NOT NULL,
    "crewMemberId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_crew_member_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_crew_member_lines" (
    "id" TEXT NOT NULL,
    "crewMemberId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "access" "CrewLineAccess",
    "rank" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_crew_member_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_crew_absence_types" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "requestable" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_crew_absence_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_crew_occurrences" (
    "id" TEXT NOT NULL,
    "crewMemberId" TEXT NOT NULL,
    "kind" "CrewOccurrenceKind" NOT NULL,
    "absenceTypeId" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "startNotBefore" INTEGER,
    "endNotAfter" INTEGER,
    "requested" JSONB,
    "status" "CrewOccurrenceStatus" NOT NULL DEFAULT 'APPROVED',
    "origin" "CrewOccurrenceOrigin" NOT NULL DEFAULT 'STAFF',
    "createdByUserId" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "notes" TEXT,
    "reviewNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_crew_occurrences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "holidays_date_branchId_key" ON "holidays"("date", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "transit_rest_patterns_name_key" ON "transit_rest_patterns"("name");

-- CreateIndex
CREATE UNIQUE INDEX "transit_crew_members_employeeId_key" ON "transit_crew_members"("employeeId");

-- CreateIndex
CREATE INDEX "transit_crew_member_shifts_crewMemberId_validFrom_idx" ON "transit_crew_member_shifts"("crewMemberId", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "transit_crew_member_lines_crewMemberId_lineId_key" ON "transit_crew_member_lines"("crewMemberId", "lineId");

-- CreateIndex
CREATE UNIQUE INDEX "transit_crew_member_lines_crewMemberId_rank_key" ON "transit_crew_member_lines"("crewMemberId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "transit_crew_absence_types_code_key" ON "transit_crew_absence_types"("code");

-- CreateIndex
CREATE INDEX "transit_crew_occurrences_crewMemberId_startDate_idx" ON "transit_crew_occurrences"("crewMemberId", "startDate");

-- AddForeignKey
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_crew_shifts" ADD CONSTRAINT "transit_crew_shifts_restPatternId_fkey" FOREIGN KEY ("restPatternId") REFERENCES "transit_rest_patterns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_crew_members" ADD CONSTRAINT "transit_crew_members_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_crew_members" ADD CONSTRAINT "transit_crew_members_restPatternId_fkey" FOREIGN KEY ("restPatternId") REFERENCES "transit_rest_patterns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_crew_members" ADD CONSTRAINT "transit_crew_members_preferredVehicleId_fkey" FOREIGN KEY ("preferredVehicleId") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_crew_member_shifts" ADD CONSTRAINT "transit_crew_member_shifts_crewMemberId_fkey" FOREIGN KEY ("crewMemberId") REFERENCES "transit_crew_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_crew_member_shifts" ADD CONSTRAINT "transit_crew_member_shifts_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "transit_crew_shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_crew_member_lines" ADD CONSTRAINT "transit_crew_member_lines_crewMemberId_fkey" FOREIGN KEY ("crewMemberId") REFERENCES "transit_crew_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_crew_member_lines" ADD CONSTRAINT "transit_crew_member_lines_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "transit_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_crew_occurrences" ADD CONSTRAINT "transit_crew_occurrences_crewMemberId_fkey" FOREIGN KEY ("crewMemberId") REFERENCES "transit_crew_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_crew_occurrences" ADD CONSTRAINT "transit_crew_occurrences_absenceTypeId_fkey" FOREIGN KEY ("absenceTypeId") REFERENCES "transit_crew_absence_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- interShiftRest moved from the roster settings (global only, until now) to the crew settings
-- (CCT, per transit Scope): a value already saved follows into the global crew row; the old
-- roster rows lose their criteria (the roster schema no longer has `range`).
UPDATE "settings" c
SET "value" = jsonb_set(c."value"::jsonb, '{range,interShiftRest}', r."value"::jsonb -> 'range' -> 'interShiftRest')
FROM "settings" r
WHERE c."key" = 'transit.crew' AND c."scope" = 'global'
  AND r."key" = 'transit.roster' AND r."scope" = 'global'
  AND r."value"::jsonb -> 'range' -> 'interShiftRest' IS NOT NULL
  AND c."value"::jsonb ? 'range';

UPDATE "settings" SET "value" = "value"::jsonb - 'range' WHERE "key" = 'transit.roster';
