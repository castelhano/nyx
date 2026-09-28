-- AlterTable
ALTER TABLE "transit_vehicle_blocks" ADD COLUMN     "hasIssues" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "issues" JSONB;
