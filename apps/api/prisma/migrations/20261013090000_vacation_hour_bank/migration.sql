-- CreateEnum
CREATE TYPE "HourBankEntryKind" AS ENUM ('OPENING', 'ADJUST', 'DAY');

-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "workDaysPerWeek" INTEGER NOT NULL DEFAULT 6;

-- AlterTable
ALTER TABLE "transit_crew_occurrences" ADD COLUMN     "coverCrewMemberId" TEXT;

-- CreateTable
CREATE TABLE "transit_hour_bank_entries" (
    "id" TEXT NOT NULL,
    "crewMemberId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" "HourBankEntryKind" NOT NULL,
    "minutes" INTEGER NOT NULL,
    "payMinutes" INTEGER NOT NULL DEFAULT 0,
    "holidayMinutes" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL,
    "occurrence" TEXT,
    "notes" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_hour_bank_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_hour_bank_closings" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "userId" TEXT,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transit_hour_bank_closings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_hour_bank_lots" (
    "id" TEXT NOT NULL,
    "crewMemberId" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "credit" INTEGER NOT NULL,
    "debit" INTEGER NOT NULL,
    "minutes" INTEGER NOT NULL,
    "payout" INTEGER NOT NULL,
    "pay" INTEGER NOT NULL,
    "holiday" INTEGER NOT NULL,
    "forgiven" INTEGER NOT NULL,
    "negative" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transit_hour_bank_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_crew_timesheet_imports" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "fileName" TEXT NOT NULL,
    "userId" TEXT,
    "summary" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transit_crew_timesheet_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_crew_timesheet_days" (
    "id" TEXT NOT NULL,
    "crewMemberId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "occurrence" TEXT NOT NULL,
    "extraMinutes" INTEGER NOT NULL,
    "shortMinutes" INTEGER NOT NULL,
    "workedMinutes" INTEGER NOT NULL,
    "hash" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_crew_timesheet_days_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transit_hour_bank_entries_crewMemberId_date_idx" ON "transit_hour_bank_entries"("crewMemberId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "transit_hour_bank_closings_branchId_month_key" ON "transit_hour_bank_closings"("branchId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "transit_hour_bank_lots_crewMemberId_month_key" ON "transit_hour_bank_lots"("crewMemberId", "month");

-- CreateIndex
CREATE INDEX "transit_crew_timesheet_imports_branchId_fromDate_idx" ON "transit_crew_timesheet_imports"("branchId", "fromDate");

-- CreateIndex
CREATE INDEX "transit_crew_timesheet_days_date_idx" ON "transit_crew_timesheet_days"("date");

-- CreateIndex
CREATE UNIQUE INDEX "transit_crew_timesheet_days_crewMemberId_date_key" ON "transit_crew_timesheet_days"("crewMemberId", "date");

-- CreateIndex
CREATE INDEX "transit_crew_occurrences_coverCrewMemberId_startDate_idx" ON "transit_crew_occurrences"("coverCrewMemberId", "startDate");

-- AddForeignKey
ALTER TABLE "transit_crew_occurrences" ADD CONSTRAINT "transit_crew_occurrences_coverCrewMemberId_fkey" FOREIGN KEY ("coverCrewMemberId") REFERENCES "transit_crew_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_hour_bank_entries" ADD CONSTRAINT "transit_hour_bank_entries_crewMemberId_fkey" FOREIGN KEY ("crewMemberId") REFERENCES "transit_crew_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_hour_bank_lots" ADD CONSTRAINT "transit_hour_bank_lots_crewMemberId_fkey" FOREIGN KEY ("crewMemberId") REFERENCES "transit_crew_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_crew_timesheet_days" ADD CONSTRAINT "transit_crew_timesheet_days_crewMemberId_fkey" FOREIGN KEY ("crewMemberId") REFERENCES "transit_crew_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- System absence type: férias (may name a ferista)
INSERT INTO "transit_crew_absence_types" ("id", "code", "name", "requestable", "isActive", "effect", "systemKey", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'FE', 'Férias', false, true, 'ABSENCE', 'VACATION', now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "transit_crew_absence_types" WHERE "code" = 'FE');
UPDATE "transit_crew_absence_types" SET "systemKey" = 'VACATION', "effect" = 'ABSENCE' WHERE "code" = 'FE' AND "systemKey" IS NULL;
