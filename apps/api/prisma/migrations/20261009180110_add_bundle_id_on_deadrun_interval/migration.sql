-- AlterTable
ALTER TABLE "transit_block_deadruns" ADD COLUMN     "bundleId" TEXT;

-- AlterTable
ALTER TABLE "transit_block_intervals" ADD COLUMN     "bundleId" TEXT;

-- CreateIndex
CREATE INDEX "transit_block_deadruns_bundleId_idx" ON "transit_block_deadruns"("bundleId");

-- CreateIndex
CREATE INDEX "transit_block_intervals_bundleId_idx" ON "transit_block_intervals"("bundleId");
