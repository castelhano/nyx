-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_transit_route_localities" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "routeId" TEXT NOT NULL,
    "localityId" TEXT,
    "lat" REAL,
    "lng" REAL,
    "sequence" INTEGER NOT NULL,
    "deltaMinutes" INTEGER,
    "deltaKm" REAL,
    "deltaSource" TEXT NOT NULL DEFAULT 'OSRM',
    "geometry" JSONB,
    "allowsCrewChange" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "transit_route_localities_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "transit_routes" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "transit_route_localities_localityId_fkey" FOREIGN KEY ("localityId") REFERENCES "transit_localities" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_transit_route_localities" ("allowsCrewChange", "createdAt", "deltaKm", "deltaMinutes", "id", "localityId", "routeId", "sequence", "updatedAt") SELECT "allowsCrewChange", "createdAt", "deltaKm", "deltaMinutes", "id", "localityId", "routeId", "sequence", "updatedAt" FROM "transit_route_localities";
DROP TABLE "transit_route_localities";
ALTER TABLE "new_transit_route_localities" RENAME TO "transit_route_localities";
CREATE UNIQUE INDEX "transit_route_localities_routeId_sequence_key" ON "transit_route_localities"("routeId", "sequence");
CREATE UNIQUE INDEX "transit_route_localities_routeId_localityId_key" ON "transit_route_localities"("routeId", "localityId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
