-- CreateTable
CREATE TABLE "transit_line_revisions" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "validFrom" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "approvalRef" TEXT,
    "extensionKm" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_line_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transit_line_revisions_lineId_validFrom_key" ON "transit_line_revisions"("lineId", "validFrom");

-- AddForeignKey
ALTER TABLE "transit_line_revisions" ADD CONSTRAINT "transit_line_revisions_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "transit_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
