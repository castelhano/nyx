-- CreateEnum
CREATE TYPE "TripStopPattern" AS ENUM ('LOCAL', 'LIMITED', 'EXPRESS');

-- AlterTable
ALTER TABLE "transit_line_departures" ADD COLUMN     "stopPattern" "TripStopPattern" NOT NULL DEFAULT 'LOCAL';

-- AlterTable
ALTER TABLE "transit_trips" ADD COLUMN     "stopPattern" "TripStopPattern" NOT NULL DEFAULT 'LOCAL';
