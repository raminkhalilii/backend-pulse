-- CreateEnum
CREATE TYPE "PlatformType" AS ENUM ('WEBHOOK', 'SLACK', 'DISCORD');

-- AlterTable
ALTER TABLE "AlertChannel" ADD COLUMN     "platformMetadata" JSONB;

-- AlterTable
ALTER TABLE "WebhookDeliveryLog" ADD COLUMN     "platformType" "PlatformType" NOT NULL DEFAULT 'WEBHOOK';
