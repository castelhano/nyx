-- CreateEnum
CREATE TYPE "EmployeeChangeOrigin" AS ENUM ('STAFF', 'PORTAL');

-- CreateTable
CREATE TABLE "employee_changes" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "origin" "EmployeeChangeOrigin" NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employee_changes_employeeId_createdAt_idx" ON "employee_changes"("employeeId", "createdAt");

-- AddForeignKey
ALTER TABLE "employee_changes" ADD CONSTRAINT "employee_changes_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_changes" ADD CONSTRAINT "employee_changes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
