-- Add per-instance host port for Node-RED apps (container :1880 -> host port).
ALTER TABLE "App" ADD COLUMN "noderedPort" INTEGER;

-- Unique so two Node-RED instances never bind the same host port.
CREATE UNIQUE INDEX "App_noderedPort_key" ON "App"("noderedPort");
