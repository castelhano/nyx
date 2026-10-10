-- AlterTable
ALTER TABLE "transit_duties" ADD COLUMN     "shiftId" TEXT,
ADD COLUMN     "shiftPinned" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "transit_line_operators" (
    "lineId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,

    CONSTRAINT "transit_line_operators_pkey" PRIMARY KEY ("lineId","branchId")
);

-- CreateTable
CREATE TABLE "transit_crew_shifts" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "startFloor" INTEGER NOT NULL,
    "startIdealMin" INTEGER NOT NULL,
    "startIdealMax" INTEGER NOT NULL,
    "startCeiling" INTEGER NOT NULL,
    "endFloor" INTEGER NOT NULL,
    "endIdealMin" INTEGER NOT NULL,
    "endIdealMax" INTEGER NOT NULL,
    "endCeiling" INTEGER NOT NULL,
    "allowSplit" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_crew_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transit_crew_shifts_branchId_code_key" ON "transit_crew_shifts"("branchId", "code");

-- AddForeignKey
ALTER TABLE "transit_line_operators" ADD CONSTRAINT "transit_line_operators_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "transit_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_line_operators" ADD CONSTRAINT "transit_line_operators_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_crew_shifts" ADD CONSTRAINT "transit_crew_shifts_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_duties" ADD CONSTRAINT "transit_duties_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "transit_crew_shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
