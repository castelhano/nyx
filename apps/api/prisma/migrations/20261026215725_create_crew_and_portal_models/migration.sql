-- AlterTable
ALTER TABLE "transit_crew_members" ADD COLUMN     "portalOverride" JSONB,
ADD COLUMN     "portalProfileId" TEXT;

-- CreateTable
CREATE TABLE "transit_crew_access" (
    "id" TEXT NOT NULL,
    "crewMemberId" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "mustChangePin" BOOLEAN NOT NULL DEFAULT true,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_crew_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_portal_profiles" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "permissions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_portal_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_crew_notifications" (
    "id" TEXT NOT NULL,
    "crewMemberId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "changeLogId" TEXT,
    "message" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transit_crew_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transit_crew_access_crewMemberId_key" ON "transit_crew_access"("crewMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "transit_portal_profiles_branchId_name_key" ON "transit_portal_profiles"("branchId", "name");

-- CreateIndex
CREATE INDEX "transit_crew_notifications_crewMemberId_readAt_idx" ON "transit_crew_notifications"("crewMemberId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "transit_crew_notifications_crewMemberId_changeLogId_key" ON "transit_crew_notifications"("crewMemberId", "changeLogId");

-- AddForeignKey
ALTER TABLE "transit_crew_members" ADD CONSTRAINT "transit_crew_members_portalProfileId_fkey" FOREIGN KEY ("portalProfileId") REFERENCES "transit_portal_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_crew_access" ADD CONSTRAINT "transit_crew_access_crewMemberId_fkey" FOREIGN KEY ("crewMemberId") REFERENCES "transit_crew_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_portal_profiles" ADD CONSTRAINT "transit_portal_profiles_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_crew_notifications" ADD CONSTRAINT "transit_crew_notifications_crewMemberId_fkey" FOREIGN KEY ("crewMemberId") REFERENCES "transit_crew_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
