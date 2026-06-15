-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_transit_block_trips" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vehicleBlockId" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "isDeadhead" BOOLEAN NOT NULL DEFAULT false,
    "deadheadMinutes" INTEGER,
    "deadheadKm" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "transit_block_trips_vehicleBlockId_fkey" FOREIGN KEY ("vehicleBlockId") REFERENCES "transit_vehicle_blocks" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "transit_block_trips_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "transit_trips" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_transit_block_trips" ("createdAt", "deadheadKm", "deadheadMinutes", "id", "isDeadhead", "sequence", "tripId", "updatedAt", "vehicleBlockId") SELECT "createdAt", "deadheadKm", "deadheadMinutes", "id", "isDeadhead", "sequence", "tripId", "updatedAt", "vehicleBlockId" FROM "transit_block_trips";
DROP TABLE "transit_block_trips";
ALTER TABLE "new_transit_block_trips" RENAME TO "transit_block_trips";
CREATE UNIQUE INDEX "transit_block_trips_vehicleBlockId_sequence_key" ON "transit_block_trips"("vehicleBlockId", "sequence");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
