/*
  Warnings:

  - You are about to drop the `transit_depot_fleets` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `transit_service_periods` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `branchId` on the `transit_lines` table. All the data in the column will be lost.
  - You are about to drop the column `branchId` on the `transit_travel_times` table. All the data in the column will be lost.
  - You are about to drop the column `branchId` on the `transit_trips` table. All the data in the column will be lost.
  - You are about to drop the column `servicePeriodId` on the `transit_trips` table. All the data in the column will be lost.
  - You are about to drop the column `branchId` on the `transit_vehicle_plans` table. All the data in the column will be lost.
  - You are about to drop the column `servicePeriodId` on the `transit_vehicle_plans` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "transit_depot_fleets_branchId_localityId_vehicleType_key";

-- AlterTable
ALTER TABLE "transit_day_types" ADD COLUMN "pattern" JSONB;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "transit_depot_fleets";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "transit_service_periods";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "transit_line_calendar_exceptions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "validFrom" DATETIME NOT NULL,
    "validTo" DATETIME,
    "overrideDayTypeId" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "transit_line_calendar_exceptions_overrideDayTypeId_fkey" FOREIGN KEY ("overrideDayTypeId") REFERENCES "transit_day_types" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "transit_line_calendar_exception_lines" (
    "exceptionId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,

    PRIMARY KEY ("exceptionId", "lineId"),
    CONSTRAINT "transit_line_calendar_exception_lines_exceptionId_fkey" FOREIGN KEY ("exceptionId") REFERENCES "transit_line_calendar_exceptions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "transit_line_calendar_exception_lines_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "transit_lines" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "transit_vehicle_plan_lines" (
    "vehiclePlanId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,

    PRIMARY KEY ("vehiclePlanId", "lineId"),
    CONSTRAINT "transit_vehicle_plan_lines_vehiclePlanId_fkey" FOREIGN KEY ("vehiclePlanId") REFERENCES "transit_vehicle_plans" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "transit_vehicle_plan_lines_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "transit_lines" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_transit_lines" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_transit_lines" ("code", "createdAt", "id", "isActive", "name", "notes", "type", "updatedAt") SELECT "code", "createdAt", "id", "isActive", "name", "notes", "type", "updatedAt" FROM "transit_lines";
DROP TABLE "transit_lines";
ALTER TABLE "new_transit_lines" RENAME TO "transit_lines";
CREATE TABLE "new_transit_travel_times" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "originId" TEXT NOT NULL,
    "destinationId" TEXT NOT NULL,
    "baseMinutes" REAL NOT NULL,
    "distanceKm" REAL NOT NULL,
    "peakMultiplier" REAL NOT NULL DEFAULT 1.0,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "transit_travel_times_originId_fkey" FOREIGN KEY ("originId") REFERENCES "transit_localities" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "transit_travel_times_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "transit_localities" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_transit_travel_times" ("baseMinutes", "createdAt", "destinationId", "distanceKm", "id", "originId", "peakMultiplier", "source", "updatedAt") SELECT "baseMinutes", "createdAt", "destinationId", "distanceKm", "id", "originId", "peakMultiplier", "source", "updatedAt" FROM "transit_travel_times";
DROP TABLE "transit_travel_times";
ALTER TABLE "new_transit_travel_times" RENAME TO "transit_travel_times";
CREATE UNIQUE INDEX "transit_travel_times_originId_destinationId_key" ON "transit_travel_times"("originId", "destinationId");
CREATE TABLE "new_transit_trips" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dayTypeId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "departureMinutes" INTEGER NOT NULL,
    "arrivalMinutes" INTEGER NOT NULL,
    "requiredVehicleType" TEXT,
    "constraints" JSONB,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "transit_trips_dayTypeId_fkey" FOREIGN KEY ("dayTypeId") REFERENCES "transit_day_types" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "transit_trips_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "transit_routes" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_transit_trips" ("arrivalMinutes", "constraints", "createdAt", "dayTypeId", "departureMinutes", "id", "notes", "requiredVehicleType", "routeId", "updatedAt") SELECT "arrivalMinutes", "constraints", "createdAt", "dayTypeId", "departureMinutes", "id", "notes", "requiredVehicleType", "routeId", "updatedAt" FROM "transit_trips";
DROP TABLE "transit_trips";
ALTER TABLE "new_transit_trips" RENAME TO "transit_trips";
CREATE TABLE "new_transit_vehicle_blocks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vehiclePlanId" TEXT NOT NULL,
    "branchId" TEXT,
    "blockNumber" INTEGER NOT NULL,
    "depotId" TEXT NOT NULL,
    "vehicleType" TEXT NOT NULL,
    "totalMinutes" INTEGER,
    "totalKm" REAL,
    "constraints" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "transit_vehicle_blocks_vehiclePlanId_fkey" FOREIGN KEY ("vehiclePlanId") REFERENCES "transit_vehicle_plans" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "transit_vehicle_blocks_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "transit_vehicle_blocks_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "transit_localities" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_transit_vehicle_blocks" ("blockNumber", "constraints", "createdAt", "depotId", "id", "totalKm", "totalMinutes", "updatedAt", "vehiclePlanId", "vehicleType") SELECT "blockNumber", "constraints", "createdAt", "depotId", "id", "totalKm", "totalMinutes", "updatedAt", "vehiclePlanId", "vehicleType" FROM "transit_vehicle_blocks";
DROP TABLE "transit_vehicle_blocks";
ALTER TABLE "new_transit_vehicle_blocks" RENAME TO "transit_vehicle_blocks";
CREATE UNIQUE INDEX "transit_vehicle_blocks_vehiclePlanId_blockNumber_key" ON "transit_vehicle_blocks"("vehiclePlanId", "blockNumber");
CREATE TABLE "new_transit_vehicle_plans" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dayTypeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "fleetCount" INTEGER,
    "score" REAL,
    "deadrunKm" REAL,
    "generatedAt" DATETIME,
    "constraints" JSONB,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "transit_vehicle_plans_dayTypeId_fkey" FOREIGN KEY ("dayTypeId") REFERENCES "transit_day_types" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_transit_vehicle_plans" ("constraints", "createdAt", "dayTypeId", "deadrunKm", "fleetCount", "generatedAt", "id", "score", "status", "updatedAt") SELECT "constraints", "createdAt", "dayTypeId", "deadrunKm", "fleetCount", "generatedAt", "id", "score", "status", "updatedAt" FROM "transit_vehicle_plans";
DROP TABLE "transit_vehicle_plans";
ALTER TABLE "new_transit_vehicle_plans" RENAME TO "transit_vehicle_plans";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
