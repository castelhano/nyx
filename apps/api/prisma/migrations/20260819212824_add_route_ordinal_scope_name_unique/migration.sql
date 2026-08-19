-- AlterTable
ALTER TABLE "transit_routes" ADD COLUMN     "ordinal" INTEGER NOT NULL DEFAULT 0;

-- DataFix: disambiguate pre-existing route variants sharing (lineId, direction) —
-- currently only the 800/OUTBOUND pair (see docs/proposal/investigate_transit_import_duplicate_route_locality.md)
UPDATE "transit_routes" tr
SET "ordinal" = ranked.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "lineId", direction ORDER BY "isPrimary" DESC, "createdAt" ASC) - 1 AS rn
  FROM "transit_routes"
) ranked
WHERE tr.id = ranked.id AND ranked.rn > 0;

-- CreateIndex
CREATE UNIQUE INDEX "transit_routes_lineId_direction_ordinal_key" ON "transit_routes"("lineId", "direction", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "transit_scopes_name_key" ON "transit_scopes"("name");
