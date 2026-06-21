-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "organizationId" TEXT;

-- CreateIndex
CREATE INDEX "Notification_organizationId_type_createdAt_idx" ON "Notification"("organizationId", "type", "createdAt");
