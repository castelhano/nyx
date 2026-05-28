/*
  Warnings:

  - You are about to drop the column `branchId` on the `transit_day_types` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_transit_day_types" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_transit_day_types" ("code", "createdAt", "description", "id", "name", "sortOrder", "updatedAt") SELECT "code", "createdAt", "description", "id", "name", "sortOrder", "updatedAt" FROM "transit_day_types";
DROP TABLE "transit_day_types";
ALTER TABLE "new_transit_day_types" RENAME TO "transit_day_types";
CREATE UNIQUE INDEX "transit_day_types_code_key" ON "transit_day_types"("code");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
