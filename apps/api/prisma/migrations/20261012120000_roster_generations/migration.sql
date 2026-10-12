-- CreateTable
CREATE TABLE "transit_roster_generations" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "role" "CrewRole" NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "params" JSONB NOT NULL,
    "summary" JSONB NOT NULL,
    "assigned" INTEGER NOT NULL,
    "changed" INTEGER NOT NULL DEFAULT 0,
    "userId" TEXT,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transit_roster_generations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transit_roster_generations_branchId_role_fromDate_toDate_idx" ON "transit_roster_generations"("branchId", "role", "fromDate", "toDate");

