/*
  Warnings:

  - You are about to drop the column `dayTypeId` on the `transit_trips` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "transit_trip_day_types" (
    "tripId" TEXT NOT NULL,
    "dayTypeId" TEXT NOT NULL,

    PRIMARY KEY ("tripId", "dayTypeId"),
    CONSTRAINT "transit_trip_day_types_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "transit_trips" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "transit_trip_day_types_dayTypeId_fkey" FOREIGN KEY ("dayTypeId") REFERENCES "transit_day_types" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_transit_trips" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "routeId" TEXT NOT NULL,
    "departureMinutes" INTEGER NOT NULL,
    "arrivalMinutes" INTEGER NOT NULL,
    "requiredVehicleType" TEXT,
    "constraints" JSONB,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "transit_trips_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "transit_routes" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_transit_trips" ("arrivalMinutes", "constraints", "createdAt", "departureMinutes", "id", "notes", "requiredVehicleType", "routeId", "updatedAt") SELECT "arrivalMinutes", "constraints", "createdAt", "departureMinutes", "id", "notes", "requiredVehicleType", "routeId", "updatedAt" FROM "transit_trips";
DROP TABLE "transit_trips";
ALTER TABLE "new_transit_trips" RENAME TO "transit_trips";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
