import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma';
import { ALERT_DELIVERY_QUEUE } from '../queue/queue.constants';
import { AlertChannelController } from './alert-channel.controller';
import { AlertChannelService } from './alert-channel.service';
import { AlertDeliveryConsumer } from './alert-delivery.consumer';
import { EmailService } from './email.service';

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
  ],
  controllers: [AlertChannelController],
  providers: [PrismaService, EmailService, AlertDeliveryConsumer, AlertChannelService],
  exports: [EmailService, AlertChannelService],
})
export class NotificationModule {}
