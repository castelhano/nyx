-- AlterTable
ALTER TABLE "transit_line_departures" ADD COLUMN     "markings" JSONB;

-- AlterTable
ALTER TABLE "transit_trips" ADD COLUMN     "markings" JSONB;
