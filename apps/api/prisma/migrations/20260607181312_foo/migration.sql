/*
  Warnings:

  - You are about to drop the column `peakMultiplier` on the `transit_travel_times` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_transit_travel_times" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "originId" TEXT NOT NULL,
    "destinationId" TEXT NOT NULL,
    "baseMinutes" REAL NOT NULL,
    "distanceKm" REAL NOT NULL,
    "speedRatio" REAL NOT NULL DEFAULT 1.0,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "transit_travel_times_originId_fkey" FOREIGN KEY ("originId") REFERENCES "transit_localities" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "transit_travel_times_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "transit_localities" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_transit_travel_times" ("baseMinutes", "createdAt", "destinationId", "distanceKm", "id", "originId", "source", "updatedAt") SELECT "baseMinutes", "createdAt", "destinationId", "distanceKm", "id", "originId", "source", "updatedAt" FROM "transit_travel_times";
DROP TABLE "transit_travel_times";
ALTER TABLE "new_transit_travel_times" RENAME TO "transit_travel_times";
CREATE UNIQUE INDEX "transit_travel_times_originId_destinationId_key" ON "transit_travel_times"("originId", "destinationId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
