-- CreateTable
CREATE TABLE "AppDatabase" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "dbName" TEXT NOT NULL,
    "roleName" TEXT NOT NULL,
    "passwordEnc" TEXT NOT NULL,
    "host" TEXT NOT NULL DEFAULT 'postgres',
    "port" INTEGER NOT NULL DEFAULT 5432,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppDatabase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppDatabase_appId_key" ON "AppDatabase"("appId");

-- AddForeignKey
ALTER TABLE "AppDatabase" ADD CONSTRAINT "AppDatabase_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;
