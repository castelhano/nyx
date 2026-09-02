-- AlterTable
ALTER TABLE "transit_route_localities" ADD COLUMN     "includeInOso" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "transit_scopes" ADD COLUMN     "logoUrl" TEXT,
ADD COLUMN     "osoConfig" JSONB;
