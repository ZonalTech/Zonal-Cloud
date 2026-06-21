-- CreateTable
CREATE TABLE "FrappeApp" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "gitUrl" TEXT NOT NULL,
    "branch" TEXT,
    "appName" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "installed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FrappeApp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FrappeApp_appId_idx" ON "FrappeApp"("appId");

-- AddForeignKey
ALTER TABLE "FrappeApp" ADD CONSTRAINT "FrappeApp_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;
