-- AlterTable
ALTER TABLE "transit_route_localities" ADD COLUMN     "allowsVehicleStand" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "transit_routes" DROP COLUMN "layoverPolicy";

-- DropEnum
DROP TYPE "LayoverPolicy";

