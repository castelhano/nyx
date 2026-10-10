-- CreateEnum
CREATE TYPE "DailyStatus" AS ENUM ('PLANNED', 'PUBLISHED', 'CLOSED');

-- CreateEnum
CREATE TYPE "DailyEventKind" AS ENUM ('TRIP', 'DEADRUN', 'INTERVAL');

-- CreateEnum
CREATE TYPE "RosterEntryKind" AS ENUM ('DUTY', 'STANDBY', 'DAY_OFF', 'COMP_OFF');

-- CreateTable
CREATE TABLE "vehicle_unavailabilities" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_unavailabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_daily_operations" (
    "id" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "dayTypeId" TEXT NOT NULL,
    "status" "DailyStatus" NOT NULL DEFAULT 'PLANNED',
    "sources" JSONB NOT NULL,
    "summary" JSONB,
    "publishedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_daily_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_daily_blocks" (
    "id" TEXT NOT NULL,
    "dailyOperationId" TEXT NOT NULL,
    "sourceBlockId" TEXT,
    "blockNumber" INTEGER NOT NULL,
    "branchId" TEXT,
    "depotId" TEXT NOT NULL,
    "vehicleType" "VehicleType" NOT NULL,
    "vehicleId" TEXT,
    "issues" JSONB,
    "hasIssues" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_daily_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_daily_block_events" (
    "id" TEXT NOT NULL,
    "dailyOperationId" TEXT NOT NULL,
    "dailyBlockId" TEXT,
    "kind" "DailyEventKind" NOT NULL,
    "sourceId" TEXT,
    "lineId" TEXT,
    "routeId" TEXT,
    "deadrunType" "transit_deadrun_type",
    "intervalTypeId" TEXT,
    "originLocalityId" TEXT,
    "destinationLocalityId" TEXT,
    "startMinutes" INTEGER NOT NULL,
    "endMinutes" INTEGER NOT NULL,
    "requiredVehicleType" "VehicleType",
    "bundleId" TEXT,
    "isCancelled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_daily_block_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_daily_duties" (
    "id" TEXT NOT NULL,
    "dailyOperationId" TEXT NOT NULL,
    "sourceDutyId" TEXT,
    "role" "CrewRole" NOT NULL,
    "dutyNumber" INTEGER NOT NULL,
    "kind" "DutyKind" NOT NULL,
    "branchId" TEXT,
    "shiftId" TEXT,
    "summary" JSONB,
    "issues" JSONB,
    "hasIssues" BOOLEAN NOT NULL DEFAULT false,
    "isStale" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_daily_duties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_daily_duty_pieces" (
    "id" TEXT NOT NULL,
    "dailyDutyId" TEXT NOT NULL,
    "dailyBlockId" TEXT,
    "sequence" INTEGER NOT NULL,
    "startMinutes" INTEGER NOT NULL,
    "endMinutes" INTEGER NOT NULL,
    "startLocalityId" TEXT NOT NULL,
    "endLocalityId" TEXT NOT NULL,
    "isStale" BOOLEAN NOT NULL DEFAULT false,
    "staleReason" TEXT,

    CONSTRAINT "transit_daily_duty_pieces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_daily_duty_activities" (
    "id" TEXT NOT NULL,
    "dailyDutyId" TEXT NOT NULL,
    "type" "DutyActivityType" NOT NULL,
    "intervalTypeId" TEXT,
    "startMinutes" INTEGER NOT NULL,
    "endMinutes" INTEGER NOT NULL,
    "originLocalityId" TEXT,
    "destinationLocalityId" TEXT,

    CONSTRAINT "transit_daily_duty_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_roster_entries" (
    "id" TEXT NOT NULL,
    "crewMemberId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" "RosterEntryKind" NOT NULL,
    "dailyDutyId" TEXT,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_roster_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_daily_change_logs" (
    "id" TEXT NOT NULL,
    "dailyOperationId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "crewMemberIds" TEXT[],
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transit_daily_change_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vehicle_unavailabilities_vehicleId_startDate_idx" ON "vehicle_unavailabilities"("vehicleId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "transit_daily_operations_scopeId_date_key" ON "transit_daily_operations"("scopeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "transit_daily_blocks_dailyOperationId_blockNumber_key" ON "transit_daily_blocks"("dailyOperationId", "blockNumber");

-- CreateIndex
CREATE INDEX "transit_daily_block_events_dailyOperationId_idx" ON "transit_daily_block_events"("dailyOperationId");

-- CreateIndex
CREATE INDEX "transit_daily_block_events_dailyBlockId_idx" ON "transit_daily_block_events"("dailyBlockId");

-- CreateIndex
CREATE UNIQUE INDEX "transit_daily_duties_dailyOperationId_role_dutyNumber_key" ON "transit_daily_duties"("dailyOperationId", "role", "dutyNumber");

-- CreateIndex
CREATE UNIQUE INDEX "transit_daily_duty_pieces_dailyDutyId_sequence_key" ON "transit_daily_duty_pieces"("dailyDutyId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "transit_roster_entries_dailyDutyId_key" ON "transit_roster_entries"("dailyDutyId");

-- CreateIndex
CREATE INDEX "transit_roster_entries_crewMemberId_date_idx" ON "transit_roster_entries"("crewMemberId", "date");

-- CreateIndex
CREATE INDEX "transit_roster_entries_date_idx" ON "transit_roster_entries"("date");

-- CreateIndex
CREATE INDEX "transit_daily_change_logs_dailyOperationId_createdAt_idx" ON "transit_daily_change_logs"("dailyOperationId", "createdAt");

-- AddForeignKey
ALTER TABLE "vehicle_unavailabilities" ADD CONSTRAINT "vehicle_unavailabilities_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_daily_operations" ADD CONSTRAINT "transit_daily_operations_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "transit_scopes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_daily_operations" ADD CONSTRAINT "transit_daily_operations_dayTypeId_fkey" FOREIGN KEY ("dayTypeId") REFERENCES "transit_day_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_daily_blocks" ADD CONSTRAINT "transit_daily_blocks_dailyOperationId_fkey" FOREIGN KEY ("dailyOperationId") REFERENCES "transit_daily_operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_daily_blocks" ADD CONSTRAINT "transit_daily_blocks_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_daily_block_events" ADD CONSTRAINT "transit_daily_block_events_dailyOperationId_fkey" FOREIGN KEY ("dailyOperationId") REFERENCES "transit_daily_operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_daily_block_events" ADD CONSTRAINT "transit_daily_block_events_dailyBlockId_fkey" FOREIGN KEY ("dailyBlockId") REFERENCES "transit_daily_blocks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_daily_duties" ADD CONSTRAINT "transit_daily_duties_dailyOperationId_fkey" FOREIGN KEY ("dailyOperationId") REFERENCES "transit_daily_operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_daily_duty_pieces" ADD CONSTRAINT "transit_daily_duty_pieces_dailyDutyId_fkey" FOREIGN KEY ("dailyDutyId") REFERENCES "transit_daily_duties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_daily_duty_pieces" ADD CONSTRAINT "transit_daily_duty_pieces_dailyBlockId_fkey" FOREIGN KEY ("dailyBlockId") REFERENCES "transit_daily_blocks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_daily_duty_activities" ADD CONSTRAINT "transit_daily_duty_activities_dailyDutyId_fkey" FOREIGN KEY ("dailyDutyId") REFERENCES "transit_daily_duties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_roster_entries" ADD CONSTRAINT "transit_roster_entries_crewMemberId_fkey" FOREIGN KEY ("crewMemberId") REFERENCES "transit_crew_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_roster_entries" ADD CONSTRAINT "transit_roster_entries_dailyDutyId_fkey" FOREIGN KEY ("dailyDutyId") REFERENCES "transit_daily_duties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_daily_change_logs" ADD CONSTRAINT "transit_daily_change_logs_dailyOperationId_fkey" FOREIGN KEY ("dailyOperationId") REFERENCES "transit_daily_operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

