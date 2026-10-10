-- CreateEnum
CREATE TYPE "ServiceRequirementKind" AS ENUM ('BOARDING', 'ALIGHTING');

-- CreateTable
CREATE TABLE "transit_line_service_requirements" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "dayTypeId" TEXT NOT NULL,
    "direction" "RouteDirection" NOT NULL,
    "kind" "ServiceRequirementKind" NOT NULL,
    "localityId" TEXT,
    "earliestMinutes" INTEGER NOT NULL,
    "latestMinutes" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_line_service_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transit_line_service_requirements_lineId_dayTypeId_idx" ON "transit_line_service_requirements"("lineId", "dayTypeId");

-- AddForeignKey
ALTER TABLE "transit_line_service_requirements" ADD CONSTRAINT "transit_line_service_requirements_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "transit_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_line_service_requirements" ADD CONSTRAINT "transit_line_service_requirements_dayTypeId_fkey" FOREIGN KEY ("dayTypeId") REFERENCES "transit_day_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_line_service_requirements" ADD CONSTRAINT "transit_line_service_requirements_localityId_fkey" FOREIGN KEY ("localityId") REFERENCES "transit_localities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
