-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "lastActiveAt" TIMESTAMP(3),
ADD COLUMN     "subscriptionExpiresAt" TIMESTAMP(3);
