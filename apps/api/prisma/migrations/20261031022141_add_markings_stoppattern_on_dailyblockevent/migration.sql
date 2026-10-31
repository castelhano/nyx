-- AlterTable
ALTER TABLE "transit_daily_block_events" ADD COLUMN     "markings" JSONB,
ADD COLUMN     "stopPattern" "TripStopPattern";
