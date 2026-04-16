import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { AlertChannelType, AlertEventType, DeliveryStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma';
import { AlertDeliveryPayload } from '../alert/alert-engine.service';
import { ALERT_DELIVERY_QUEUE } from '../queue/queue.constants';
import { EmailService } from './email.service';

@Processor(ALERT_DELIVERY_QUEUE)
export class AlertDeliveryConsumer extends WorkerHost {
  private readonly logger = new Logger(AlertDeliveryConsumer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {
    super();
  }

  async process(job: Job<AlertDeliveryPayload>): Promise<void> {
    if (job.name === 'deliver-alert') {
      return this.processAlertDelivery(job);
    }
    this.logger.warn(`Received unknown job name "${job.name}" on alert-delivery queue — skipping`);
  }

  private async processAlertDelivery(job: Job<AlertDeliveryPayload>): Promise<void> {
    const { alertEventId } = job.data;

    this.logger.log(
      `Processing alert delivery — alertEventId=${alertEventId} attempt=${job.attemptsMade + 1}`,
    );

    // ── a) Load AlertEvent with its monitor and the monitor's owner ───────────
    const alertEvent = await this.prisma.alertEvent.findUnique({
      where: { id: alertEventId },
      include: {
        monitor: {
          include: { user: true },
        },
      },
    });

    if (!alertEvent) {
      // The record might have been deleted — nothing to deliver.
      this.logger.warn(`AlertEvent ${alertEventId} not found — skipping job`);
      return;
    }

    const { monitor } = alertEvent;
    const { user } = monitor;

    // ── b) Load all enabled EMAIL channels for this user ─────────────────────
    const emailChannels = await this.prisma.alertChannel.findMany({
      where: {
        userId: user.id,
        type: AlertChannelType.EMAIL,
        enabled: true,
      },
    });

    if (emailChannels.length === 0) {
      this.logger.warn(
        `No enabled email channels for userId=${user.id} (monitor="${monitor.name}") ` +
          `— marking alertEventId=${alertEventId} as SENT (no-op)`,
      );
      await this.prisma.alertEvent.update({
        where: { id: alertEventId },
        data: { deliveryStatus: DeliveryStatus.SENT },
      });
      return;
    }

    // ── c) Attempt delivery to every channel, collecting failures ─────────────
    // Fire-and-collect: never short-circuit on the first failure.
    const failures: Array<{ channelId: string; email: string; error: string }> = [];

    const dashboardUrl = `${process.env.APP_URL ?? 'https://pulsee.website'}/dashboard`;
    const metadata = (alertEvent.metadata ?? {}) as Record<string, unknown>;

    const responseTimeMs = typeof metadata.latencyMs === 'number' ? metadata.latencyMs : undefined;
    const errorMessage =
      typeof metadata.errorMessage === 'string' ? metadata.errorMessage : undefined;

    for (const channel of emailChannels) {
      try {
        await this.emailService.sendAlertEmail({
          to: channel.value,
          monitorName: monitor.name,
          monitorUrl: monitor.url,
          type: alertEvent.type === AlertEventType.DOWN ? 'DOWN' : 'RECOVERY',
          triggeredAt: alertEvent.triggeredAt,
          responseTimeMs,
          errorMessage,
          dashboardUrl,
        });

        this.logger.log(
          `Email delivered — channelId=${channel.id} to=${channel.value} type=${alertEvent.type}`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Email delivery failed — channelId=${channel.id} to=${channel.value}: ${message}`,
        );
        failures.push({ channelId: channel.id, email: channel.value, error: message });
      }
    }

    // ── d) Update AlertEvent.deliveryStatus based on aggregate result ─────────
    if (failures.length === 0) {
      await this.prisma.alertEvent.update({
        where: { id: alertEventId },
        data: { deliveryStatus: DeliveryStatus.SENT },
      });

      this.logger.log(
        `Alert delivery complete — alertEventId=${alertEventId} status=SENT ` +
          `channels=${emailChannels.length}`,
      );
    } else {
      // Mark failed first so the record reflects failure even if the rethrow
      // triggers BullMQ to retry the whole job.
      await this.prisma.alertEvent.update({
        where: { id: alertEventId },
        data: { deliveryStatus: DeliveryStatus.FAILED },
      });

      const failedAddresses = failures.map((f) => f.email).join(', ');
      this.logger.error(
        `Alert delivery failed — alertEventId=${alertEventId} failedChannels=${failedAddresses}`,
      );

      // Throw so BullMQ retries the job (exponential back-off configured in
      // NotificationModule queue registration and alert.module.ts).
      throw new Error(
        `Delivery failed for alertEventId=${alertEventId} on channels: ${failedAddresses}`,
      );
    }
  }
}
