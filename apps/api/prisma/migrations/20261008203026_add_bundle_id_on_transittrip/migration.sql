-- AlterTable
ALTER TABLE "transit_trips" ADD COLUMN     "bundleId" TEXT;

-- CreateIndex
CREATE INDEX "transit_trips_bundleId_idx" ON "transit_trips"("bundleId");
