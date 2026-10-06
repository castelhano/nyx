-- AlterTable
ALTER TABLE "transit_lines" ADD COLUMN     "externalCodes" JSONB;

-- AlterTable
ALTER TABLE "transit_localities" ADD COLUMN     "externalCodes" JSONB;
