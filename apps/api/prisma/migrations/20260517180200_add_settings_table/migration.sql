/*
  Warnings:

  - You are about to drop the `password_policy` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "password_policy";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'global',
    "value" JSONB NOT NULL,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("key", "scope")
);
