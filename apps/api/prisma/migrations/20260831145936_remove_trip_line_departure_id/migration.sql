-- DropForeignKey
ALTER TABLE "transit_trips" DROP CONSTRAINT "transit_trips_lineDepartureId_fkey";

-- AlterTable
ALTER TABLE "transit_trips" DROP COLUMN "lineDepartureId";
