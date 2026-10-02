-- AlterTable
ALTER TABLE "transit_lines" ADD COLUMN     "vehicleTypes" JSONB;

-- AlterTable
ALTER TABLE "transit_localities" ADD COLUMN     "depot" JSONB;
