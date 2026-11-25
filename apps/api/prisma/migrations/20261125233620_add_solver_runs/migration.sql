-- CreateEnum
CREATE TYPE "SolverRunKind" AS ENUM ('VEHICLE', 'CREW');

-- CreateEnum
CREATE TYPE "SolverRunStatus" AS ENUM ('RUNNING', 'DONE', 'ERROR', 'INTERRUPTED');

-- CreateTable
CREATE TABLE "transit_solver_runs" (
    "id" TEXT NOT NULL,
    "kind" "SolverRunKind" NOT NULL,
    "vehiclePlanId" TEXT,
    "crewPlanId" TEXT,
    "status" "SolverRunStatus" NOT NULL DEFAULT 'RUNNING',
    "params" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "baseline" JSONB,
    "start" JSONB,
    "progress" JSONB,
    "best" JSONB,
    "stopReason" TEXT,
    "error" TEXT,
    "userId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_solver_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transit_solver_runs_vehiclePlanId_key" ON "transit_solver_runs"("vehiclePlanId");

-- CreateIndex
CREATE UNIQUE INDEX "transit_solver_runs_crewPlanId_key" ON "transit_solver_runs"("crewPlanId");

-- AddForeignKey
ALTER TABLE "transit_solver_runs" ADD CONSTRAINT "transit_solver_runs_vehiclePlanId_fkey" FOREIGN KEY ("vehiclePlanId") REFERENCES "transit_vehicle_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_solver_runs" ADD CONSTRAINT "transit_solver_runs_crewPlanId_fkey" FOREIGN KEY ("crewPlanId") REFERENCES "transit_crew_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
