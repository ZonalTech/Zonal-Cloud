-- Rename Org -> Organization, orgId -> organizationId, and add User.username.
-- Data-preserving: uses ALTER ... RENAME throughout (no DROP/CREATE), and
-- backfills username from the email local-part for existing users.

-- ── Enums: OrgPlan -> OrganizationPlan, OrgStatus -> OrganizationStatus ──
ALTER TYPE "OrgPlan" RENAME TO "OrganizationPlan";
ALTER TYPE "OrgStatus" RENAME TO "OrganizationStatus";

-- ── Table: Org -> Organization ──────────────────────────────────────────
ALTER TABLE "Org" RENAME TO "Organization";
ALTER TABLE "Organization" RENAME CONSTRAINT "Org_pkey" TO "Organization_pkey";
ALTER INDEX "Org_slug_key" RENAME TO "Organization_slug_key";

-- ── User: orgId -> organizationId, add username ─────────────────────────
ALTER TABLE "User" RENAME COLUMN "orgId" TO "organizationId";
ALTER TABLE "User" RENAME CONSTRAINT "User_orgId_fkey" TO "User_organizationId_fkey";

-- Add username (nullable first so we can backfill, then enforce NOT NULL + unique).
ALTER TABLE "User" ADD COLUMN "username" TEXT;
-- Backfill from the email local-part; de-duplicate by appending a short id suffix
-- when two emails share a local-part.
UPDATE "User" u
SET "username" = split_part(u."email", '@', 1) ||
  CASE
    WHEN (
      SELECT count(*) FROM "User" v
      WHERE split_part(v."email", '@', 1) = split_part(u."email", '@', 1)
    ) > 1 THEN '-' || substr(u."id", 1, 6)
    ELSE ''
  END;
ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- ── Quota: orgId -> organizationId ──────────────────────────────────────
ALTER TABLE "Quota" RENAME COLUMN "orgId" TO "organizationId";
ALTER TABLE "Quota" RENAME CONSTRAINT "Quota_orgId_fkey" TO "Quota_organizationId_fkey";
ALTER INDEX "Quota_orgId_key" RENAME TO "Quota_organizationId_key";

-- ── Project: orgId -> organizationId ────────────────────────────────────
ALTER TABLE "Project" RENAME COLUMN "orgId" TO "organizationId";
ALTER TABLE "Project" RENAME CONSTRAINT "Project_orgId_fkey" TO "Project_organizationId_fkey";

-- ── AgentToken: orgId -> organizationId (no FK/index to rename) ──────────
ALTER TABLE "AgentToken" RENAME COLUMN "orgId" TO "organizationId";
