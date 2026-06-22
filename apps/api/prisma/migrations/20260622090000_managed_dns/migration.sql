-- Managed DNS hosting product.
-- Ownership/billing/quota for customer DNS zones. The authoritative record data
-- lives in PowerDNS's own `pdns` database, not here.

-- DNS add-on quota: how many zones an org may host (0 = add-on not purchased).
ALTER TABLE "Quota" ADD COLUMN "maxDnsZones" INTEGER NOT NULL DEFAULT 0;

-- CreateEnum
CREATE TYPE "DnsZoneStatus" AS ENUM ('active', 'suspended');

-- CreateTable
CREATE TABLE "DnsZone" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "DnsZoneStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DnsZone_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DnsZone_name_key" ON "DnsZone"("name");

-- CreateIndex
CREATE INDEX "DnsZone_organizationId_idx" ON "DnsZone"("organizationId");

-- AddForeignKey
ALTER TABLE "DnsZone" ADD CONSTRAINT "DnsZone_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
