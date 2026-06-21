-- Store the Node-RED default admin password (encrypted) so the dashboard can
-- auto-login to the editor via /auth/token.
ALTER TABLE "App" ADD COLUMN "noderedAdminPasswordEnc" TEXT;
