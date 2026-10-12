-- AlterTable
ALTER TABLE "transit_crew_members" ADD COLUMN     "standbyBlocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "standbyRank" INTEGER;

