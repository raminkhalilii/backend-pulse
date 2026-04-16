-- CreateEnum
CREATE TYPE "AlertEventType" AS ENUM ('DOWN', 'RECOVERY');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "AlertChannelType" AS ENUM ('EMAIL', 'WEBHOOK', 'SLACK', 'DISCORD');

-- AlterTable
ALTER TABLE "Monitor" ADD COLUMN     "alertThreshold" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastAlertedAt" TIMESTAMP(3),
ADD COLUMN     "lastStatus" "PingStatus";

-- CreateTable
CREATE TABLE "AlertEvent" (
    "id" TEXT NOT NULL,
    "monitorId" TEXT NOT NULL,
    "type" "AlertEventType" NOT NULL,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveryStatus" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "metadata" JSONB,

    CONSTRAINT "AlertEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertChannel" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "AlertChannelType" NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertChannel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AlertEvent_monitorId_triggeredAt_idx" ON "AlertEvent"("monitorId", "triggeredAt" DESC);

-- CreateIndex
CREATE INDEX "AlertChannel_userId_idx" ON "AlertChannel"("userId");

-- AddForeignKey
ALTER TABLE "AlertEvent" ADD CONSTRAINT "AlertEvent_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertChannel" ADD CONSTRAINT "AlertChannel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
