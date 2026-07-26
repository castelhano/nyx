-- CreateTable
CREATE TABLE "transit_interval_types" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "minMinutes" INTEGER,
    "maxMinutes" INTEGER,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "transit_block_intervals" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vehicleBlockId" TEXT NOT NULL,
    "intervalTypeId" TEXT NOT NULL,
    "departureMinutes" INTEGER NOT NULL,
    "arrivalMinutes" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "transit_block_intervals_vehicleBlockId_fkey" FOREIGN KEY ("vehicleBlockId") REFERENCES "transit_vehicle_blocks" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "transit_block_intervals_intervalTypeId_fkey" FOREIGN KEY ("intervalTypeId") REFERENCES "transit_interval_types" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "transit_interval_types_code_key" ON "transit_interval_types"("code");
