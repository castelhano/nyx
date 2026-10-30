-- CreateEnum
CREATE TYPE "CrewChangeRequestKind" AS ENUM ('SHIFT', 'REST_GROUP');

-- CreateEnum
CREATE TYPE "CrewChangeRequestStatus" AS ENUM ('REQUESTED', 'QUEUED', 'FULFILLED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "transit_crew_change_requests" (
    "id" TEXT NOT NULL,
    "crewMemberId" TEXT NOT NULL,
    "kind" "CrewChangeRequestKind" NOT NULL,
    "status" "CrewChangeRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "origin" "CrewOccurrenceOrigin" NOT NULL DEFAULT 'PORTAL',
    "shiftId" TEXT,
    "restPatternId" TEXT,
    "restOffset" INTEGER,
    "fromShiftId" TEXT,
    "fromOffset" INTEGER,
    "notes" TEXT,
    "reviewNotes" TEXT,
    "createdByUserId" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "fulfilledAt" TIMESTAMP(3),
    "adjustmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_crew_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transit_crew_change_requests_crewMemberId_status_idx" ON "transit_crew_change_requests"("crewMemberId", "status");

-- CreateIndex
CREATE INDEX "transit_crew_change_requests_kind_status_createdAt_idx" ON "transit_crew_change_requests"("kind", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "transit_crew_change_requests" ADD CONSTRAINT "transit_crew_change_requests_crewMemberId_fkey" FOREIGN KEY ("crewMemberId") REFERENCES "transit_crew_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_crew_change_requests" ADD CONSTRAINT "transit_crew_change_requests_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "transit_crew_shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_crew_change_requests" ADD CONSTRAINT "transit_crew_change_requests_fromShiftId_fkey" FOREIGN KEY ("fromShiftId") REFERENCES "transit_crew_shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_crew_change_requests" ADD CONSTRAINT "transit_crew_change_requests_restPatternId_fkey" FOREIGN KEY ("restPatternId") REFERENCES "transit_rest_patterns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
