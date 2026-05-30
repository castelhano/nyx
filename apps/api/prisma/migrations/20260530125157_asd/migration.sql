/*
  Warnings:

  - Made the column `code` on table `transit_localities` required. This step will fail if there are existing NULL values in that column.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_transit_localities" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
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
CREATE UNIQUE INDEX "transit_localities_code_key" ON "transit_localities"("code");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
