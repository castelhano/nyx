-- CreateEnum
CREATE TYPE "LayoverPolicy" AS ENUM ('DEFAULT', 'HOLD', 'DEPOT');

-- AlterTable
ALTER TABLE "transit_routes" ADD COLUMN     "homeDepotId" TEXT,
ADD COLUMN     "layoverPolicy" "LayoverPolicy" NOT NULL DEFAULT 'DEFAULT';

-- AddForeignKey
ALTER TABLE "transit_routes" ADD CONSTRAINT "transit_routes_homeDepotId_fkey" FOREIGN KEY ("homeDepotId") REFERENCES "transit_localities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
