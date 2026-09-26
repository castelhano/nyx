-- CreateEnum
CREATE TYPE "CrewPlanStatus" AS ENUM ('DRAFT', 'ACTIVE');

-- CreateEnum
CREATE TYPE "CrewRole" AS ENUM ('DRIVER', 'FARE_COLLECTOR', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "DutyKind" AS ENUM ('STRAIGHT', 'SPLIT', 'TRIPPER', 'STANDBY');

-- CreateEnum
CREATE TYPE "DutyActivityType" AS ENUM ('SIGN_ON', 'SIGN_OFF', 'BREAK', 'TRAVEL', 'STANDBY');

-- CreateTable
CREATE TABLE "transit_crew_plans" (
    "id" TEXT NOT NULL,
    "vehiclePlanId" TEXT NOT NULL,
    "description" TEXT,
    "status" "CrewPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "summary" JSONB,
    "settings" JSONB,
    "constraints" JSONB,
    "generatedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_crew_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_duties" (
    "id" TEXT NOT NULL,
    "crewPlanId" TEXT NOT NULL,
    "role" "CrewRole" NOT NULL DEFAULT 'DRIVER',
    "dutyNumber" INTEGER NOT NULL,
    "kind" "DutyKind" NOT NULL DEFAULT 'STRAIGHT',
    "branchId" TEXT,
    "summary" JSONB,
    "isStale" BOOLEAN NOT NULL DEFAULT false,
    "issues" JSONB,
    "hasIssues" BOOLEAN NOT NULL DEFAULT false,
    "constraints" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_duties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_duty_pieces" (
    "id" TEXT NOT NULL,
    "dutyId" TEXT NOT NULL,
    "vehicleBlockId" TEXT,
    "sequence" INTEGER NOT NULL,
    "startMinutes" INTEGER NOT NULL,
    "endMinutes" INTEGER NOT NULL,
    "startLocalityId" TEXT NOT NULL,
    "endLocalityId" TEXT NOT NULL,
    "isStale" BOOLEAN NOT NULL DEFAULT false,
    "staleReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_duty_pieces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_duty_activities" (
    "id" TEXT NOT NULL,
    "dutyId" TEXT NOT NULL,
    "type" "DutyActivityType" NOT NULL,
    "intervalTypeId" TEXT,
    "startMinutes" INTEGER NOT NULL,
    "endMinutes" INTEGER NOT NULL,
    "originLocalityId" TEXT,
    "destinationLocalityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_duty_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transit_duties_crewPlanId_role_dutyNumber_key" ON "transit_duties"("crewPlanId", "role", "dutyNumber");

-- CreateIndex
CREATE UNIQUE INDEX "transit_duty_pieces_dutyId_sequence_key" ON "transit_duty_pieces"("dutyId", "sequence");

-- AddForeignKey
ALTER TABLE "transit_crew_plans" ADD CONSTRAINT "transit_crew_plans_vehiclePlanId_fkey" FOREIGN KEY ("vehiclePlanId") REFERENCES "transit_vehicle_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_duties" ADD CONSTRAINT "transit_duties_crewPlanId_fkey" FOREIGN KEY ("crewPlanId") REFERENCES "transit_crew_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_duties" ADD CONSTRAINT "transit_duties_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_duty_pieces" ADD CONSTRAINT "transit_duty_pieces_dutyId_fkey" FOREIGN KEY ("dutyId") REFERENCES "transit_duties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_duty_pieces" ADD CONSTRAINT "transit_duty_pieces_vehicleBlockId_fkey" FOREIGN KEY ("vehicleBlockId") REFERENCES "transit_vehicle_blocks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_duty_pieces" ADD CONSTRAINT "transit_duty_pieces_startLocalityId_fkey" FOREIGN KEY ("startLocalityId") REFERENCES "transit_localities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_duty_pieces" ADD CONSTRAINT "transit_duty_pieces_endLocalityId_fkey" FOREIGN KEY ("endLocalityId") REFERENCES "transit_localities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_duty_activities" ADD CONSTRAINT "transit_duty_activities_dutyId_fkey" FOREIGN KEY ("dutyId") REFERENCES "transit_duties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_duty_activities" ADD CONSTRAINT "transit_duty_activities_intervalTypeId_fkey" FOREIGN KEY ("intervalTypeId") REFERENCES "transit_interval_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_duty_activities" ADD CONSTRAINT "transit_duty_activities_originLocalityId_fkey" FOREIGN KEY ("originLocalityId") REFERENCES "transit_localities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_duty_activities" ADD CONSTRAINT "transit_duty_activities_destinationLocalityId_fkey" FOREIGN KEY ("destinationLocalityId") REFERENCES "transit_localities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- transit.schedule was split into transit.crew (per transit Scope) and transit.roster —
-- nothing ever consumed it, so its rows are simply dropped.
DELETE FROM "settings" WHERE "key" = 'transit.schedule';
