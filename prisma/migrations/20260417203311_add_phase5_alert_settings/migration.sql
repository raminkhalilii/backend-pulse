-- CreateTable
CREATE TABLE "MonitorAlertSettings" (
    "id" TEXT NOT NULL,
    "monitorId" TEXT NOT NULL,
    "alertThreshold" INTEGER NOT NULL DEFAULT 2,
    "escalationThreshold" INTEGER NOT NULL DEFAULT 5,
    "alertOnRecovery" BOOLEAN NOT NULL DEFAULT true,
    "quietHoursEnabled" BOOLEAN NOT NULL DEFAULT false,
    "quietHoursStart" TEXT,
    "quietHoursEnd" TEXT,
    "quietHoursDays" JSONB NOT NULL DEFAULT '[0,1,2,3,4,5,6]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonitorAlertSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitorAlertChannel" (
    "id" TEXT NOT NULL,
    "monitorId" TEXT NOT NULL,
    "alertChannelId" TEXT NOT NULL,
    "isEscalation" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitorAlertChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuppressedAlert" (
    "id" TEXT NOT NULL,
    "monitorId" TEXT NOT NULL,
    "type" "AlertEventType" NOT NULL,
    "suppressedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,
    "quietHoursEnd" TEXT,

    CONSTRAINT "SuppressedAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MonitorAlertSettings_monitorId_key" ON "MonitorAlertSettings"("monitorId");

-- CreateIndex
CREATE INDEX "MonitorAlertChannel_monitorId_idx" ON "MonitorAlertChannel"("monitorId");

-- CreateIndex
CREATE UNIQUE INDEX "MonitorAlertChannel_monitorId_alertChannelId_key" ON "MonitorAlertChannel"("monitorId", "alertChannelId");

-- CreateIndex
CREATE INDEX "SuppressedAlert_monitorId_suppressedAt_idx" ON "SuppressedAlert"("monitorId", "suppressedAt" DESC);

-- AddForeignKey
ALTER TABLE "MonitorAlertSettings" ADD CONSTRAINT "MonitorAlertSettings_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitorAlertChannel" ADD CONSTRAINT "MonitorAlertChannel_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitorAlertChannel" ADD CONSTRAINT "MonitorAlertChannel_alertChannelId_fkey" FOREIGN KEY ("alertChannelId") REFERENCES "AlertChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuppressedAlert" ADD CONSTRAINT "SuppressedAlert_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
