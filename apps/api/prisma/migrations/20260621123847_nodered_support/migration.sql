-- AlterTable
ALTER TABLE "App" ADD COLUMN     "noderedVolumeName" TEXT;

-- CreateTable
CREATE TABLE "NodeRedUser" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "permission" TEXT NOT NULL DEFAULT '*',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NodeRedUser_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NodeRedUser_appId_idx" ON "NodeRedUser"("appId");

-- CreateIndex
CREATE UNIQUE INDEX "NodeRedUser_appId_username_key" ON "NodeRedUser"("appId", "username");

-- AddForeignKey
ALTER TABLE "NodeRedUser" ADD CONSTRAINT "NodeRedUser_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;
