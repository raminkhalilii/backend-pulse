import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma';
import { AlertSettingsModule } from '../alert-settings/alert-settings.module';
import { ALERT_DELIVERY_QUEUE } from '../queue/queue.constants';
import { AlertChannelController } from './alert-channel.controller';
import { AlertChannelService } from './alert-channel.service';
import { AlertDeliveryConsumer } from './alert-delivery.consumer';
import { DiscordService } from './discord.service';
import { EmailService } from './email.service';
import { SlackService } from './slack.service';
import { WebhookSecurityService } from './webhook-security.service';
import { WebhookService } from './webhook.service';

@Module({
  imports: [
    /**
     * Register the alert-delivery queue with retry defaults so every job
     * added to this queue automatically inherits the back-off policy.
     *
     * NOTE: This module is intentionally imported by both AppModule (for the
     * HTTP controller) and WorkerModule (for the BullMQ consumer).  BullMQ
     * workers are designed for multi-process consumption; having a consumer
     * active in the API process as well simply provides redundancy and
     * load-balancing across processes — no duplicate deliveries occur because
     * BullMQ uses atomic job locking.
     */
    BullModule.registerQueue({
      name: ALERT_DELIVERY_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100, // Keep last 100 completed jobs for observability
        removeOnFail: 200, // Keep last 200 failed jobs for debugging
      },
    }),
    AlertSettingsModule, // AlertDeliveryConsumer injects AlertSettingsService for per-monitor routing
  ],
  controllers: [AlertChannelController],
  providers: [
    PrismaService,
    EmailService,
    WebhookSecurityService,
    WebhookService,
    SlackService,
    DiscordService,
    AlertDeliveryConsumer,
    AlertChannelService,
  ],
  exports: [EmailService, WebhookService, SlackService, DiscordService, AlertChannelService],
})
export class NotificationModule {}
