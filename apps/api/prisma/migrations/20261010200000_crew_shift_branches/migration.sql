-- CrewShift: one branch per shift → shared by several (CrewShiftBranch). Existing shifts keep
-- their branch as their only link; the code becomes unique across branches.

-- CreateTable
CREATE TABLE "transit_crew_shift_branches" (
    "shiftId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,

    CONSTRAINT "transit_crew_shift_branches_pkey" PRIMARY KEY ("shiftId","branchId")
);

-- Keep each shift's branch
INSERT INTO "transit_crew_shift_branches" ("shiftId", "branchId")
SELECT "id", "branchId" FROM "transit_crew_shifts";

-- DropForeignKey
ALTER TABLE "transit_crew_shifts" DROP CONSTRAINT "transit_crew_shifts_branchId_fkey";

-- DropIndex
DROP INDEX "transit_crew_shifts_branchId_code_key";

-- AlterTable
ALTER TABLE "transit_crew_shifts" DROP COLUMN "branchId";

-- The same code in two branches: the oldest keeps it, the others get a numeric suffix
UPDATE "transit_crew_shifts" s
SET "code" = s."code" || '-' || d.n
FROM (
    SELECT "id", ROW_NUMBER() OVER (PARTITION BY "code" ORDER BY "createdAt", "id") AS n
    FROM "transit_crew_shifts"
) d
WHERE d."id" = s."id" AND d.n > 1;

-- CreateIndex
CREATE UNIQUE INDEX "transit_crew_shifts_code_key" ON "transit_crew_shifts"("code");

-- AddForeignKey
ALTER TABLE "transit_crew_shift_branches" ADD CONSTRAINT "transit_crew_shift_branches_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "transit_crew_shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_crew_shift_branches" ADD CONSTRAINT "transit_crew_shift_branches_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
