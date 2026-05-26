/*
  Warnings:

  - You are about to drop the column `branchId` on the `transit_localities` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_transit_localities" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "lat" REAL NOT NULL,
    "lng" REAL NOT NULL,
    "isDepot" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_transit_localities" ("code", "createdAt", "id", "isDepot", "lat", "lng", "name", "notes", "updatedAt") SELECT "code", "createdAt", "id", "isDepot", "lat", "lng", "name", "notes", "updatedAt" FROM "transit_localities";
DROP TABLE "transit_localities";
ALTER TABLE "new_transit_localities" RENAME TO "transit_localities";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
