-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_transit_localities" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "lat" REAL,
    "lng" REAL,
    "isDepot" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_transit_localities" ("code", "createdAt", "id", "isDepot", "lat", "lng", "name", "notes", "updatedAt") SELECT "code", "createdAt", "id", "isDepot", "lat", "lng", "name", "notes", "updatedAt" FROM "transit_localities";
DROP TABLE "transit_localities";
ALTER TABLE "new_transit_localities" RENAME TO "transit_localities";
CREATE TABLE "new_vehicles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "branchId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "renavam" TEXT,
    "chassis" TEXT,
    "brandId" TEXT,
    "modelId" TEXT,
    "year" INTEGER,
    "modelYear" INTEGER,
    "vehicleType" TEXT NOT NULL DEFAULT 'BUS',
    "color" TEXT,
    "fuelType" TEXT NOT NULL DEFAULT 'DIESEL',
    "transmission" TEXT,
    "seatedCapacity" INTEGER,
    "totalCapacity" INTEGER,
    "odometer" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "acquisitionDate" DATETIME,
    "acquisitionValue" DECIMAL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "vehicles_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "vehicles_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "vehicle_brands" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "vehicles_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "vehicle_models" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_vehicles" ("acquisitionDate", "acquisitionValue", "branchId", "brandId", "chassis", "code", "color", "createdAt", "fuelType", "id", "modelId", "modelYear", "notes", "odometer", "plate", "renavam", "seatedCapacity", "status", "totalCapacity", "transmission", "updatedAt", "vehicleType", "year") SELECT "acquisitionDate", "acquisitionValue", "branchId", "brandId", "chassis", "code", "color", "createdAt", coalesce("fuelType", 'DIESEL') AS "fuelType", "id", "modelId", "modelYear", "notes", "odometer", "plate", "renavam", "seatedCapacity", "status", "totalCapacity", "transmission", "updatedAt", "vehicleType", "year" FROM "vehicles";
DROP TABLE "vehicles";
ALTER TABLE "new_vehicles" RENAME TO "vehicles";
CREATE UNIQUE INDEX "vehicles_code_key" ON "vehicles"("code");
CREATE UNIQUE INDEX "vehicles_plate_key" ON "vehicles"("plate");
CREATE UNIQUE INDEX "vehicles_renavam_key" ON "vehicles"("renavam");
CREATE UNIQUE INDEX "vehicles_chassis_key" ON "vehicles"("chassis");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
