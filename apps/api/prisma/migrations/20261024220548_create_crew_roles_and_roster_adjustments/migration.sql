-- AlterTable
ALTER TABLE "transit_crew_member_lines" ADD COLUMN     "priority" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "transit_daily_operations" ADD COLUMN     "crewContext" JSONB;

-- CreateTable
CREATE TABLE "transit_crew_role_job_titles" (
    "id" TEXT NOT NULL,
    "jobTitleId" TEXT NOT NULL,
    "role" "CrewRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_crew_role_job_titles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_roster_adjustments" (
    "id" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "role" "CrewRole" NOT NULL,
    "kind" TEXT NOT NULL,
    "effective" DATE NOT NULL,
    "rule" JSONB,
    "items" JSONB NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transit_roster_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transit_crew_role_job_titles_jobTitleId_key" ON "transit_crew_role_job_titles"("jobTitleId");

-- CreateIndex
CREATE INDEX "transit_roster_adjustments_branchId_role_createdAt_idx" ON "transit_roster_adjustments"("branchId", "role", "createdAt");

-- AddForeignKey
ALTER TABLE "transit_crew_role_job_titles" ADD CONSTRAINT "transit_crew_role_job_titles_jobTitleId_fkey" FOREIGN KEY ("jobTitleId") REFERENCES "job_titles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
