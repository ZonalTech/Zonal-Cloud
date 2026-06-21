-- AlterEnum
ALTER TYPE "AppType" ADD VALUE 'frappe';

-- AlterTable
ALTER TABLE "App" ADD COLUMN     "frappeAdminPasswordEnc" TEXT,
ADD COLUMN     "frappeSiteName" TEXT,
ADD COLUMN     "frappeVolumeName" TEXT;

-- CreateTable
CREATE TABLE "FrappeDatabase" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "dbName" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "passwordEnc" TEXT NOT NULL,
    "host" TEXT NOT NULL DEFAULT 'mariadb',
    "port" INTEGER NOT NULL DEFAULT 3306,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FrappeDatabase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FrappeDatabase_appId_key" ON "FrappeDatabase"("appId");

-- AddForeignKey
ALTER TABLE "FrappeDatabase" ADD CONSTRAINT "FrappeDatabase_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;
