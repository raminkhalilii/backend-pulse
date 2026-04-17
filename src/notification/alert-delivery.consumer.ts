import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { AlertChannelType, AlertEventType, DeliveryStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma';
import { AlertDeliveryPayload } from '../alert/alert-engine.service';
import { ALERT_DELIVERY_QUEUE } from '../queue/queue.constants';
import { EmailService } from './email.service';
import { WebhookResponseError } from './errors/webhook.errors';
import { WebhookService } from './webhook.service';

@Processor(ALERT_DELIVERY_QUEUE)
export class AlertDeliveryConsumer extends WorkerHost {
  private readonly logger = new Logger(AlertDeliveryConsumer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly webhookService: WebhookService,
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
      this.logger.warn(`AlertEvent ${alertEventId} not found — skipping job`);
      return;
    }

    const { monitor } = alertEvent;
    const { user } = monitor;

    // ── b) Load all enabled channels (EMAIL + WEBHOOK) in parallel ────────────
    const [emailChannels, webhookChannels] = await Promise.all([
      this.prisma.alertChannel.findMany({
        where: { userId: user.id, type: AlertChannelType.EMAIL, enabled: true },
      }),
      this.prisma.alertChannel.findMany({
        where: { userId: user.id, type: AlertChannelType.WEBHOOK, enabled: true },
      }),
    ]);

    const totalChannels = emailChannels.length + webhookChannels.length;

    if (totalChannels === 0) {
      this.logger.warn(
        `No enabled channels for userId=${user.id} (monitor="${monitor.name}") ` +
          `— marking alertEventId=${alertEventId} as SENT (no-op)`,
      );
      await this.prisma.alertEvent.update({
        where: { id: alertEventId },
        data: { deliveryStatus: DeliveryStatus.SENT },
      });
      return;
    }

    // ── c) Build shared parameters from the alert event metadata ──────────────
    const metadata = (alertEvent.metadata ?? {}) as Record<string, unknown>;
    const responseTimeMs = typeof metadata.latencyMs === 'number' ? metadata.latencyMs : undefined;
    const errorMessage =
      typeof metadata.errorMessage === 'string' ? metadata.errorMessage : undefined;
    const httpStatusCode =
      typeof metadata.statusCode === 'number' ? metadata.statusCode : undefined;

    const dashboardUrl = `${process.env.APP_URL ?? 'https://pulsee.website'}/dashboard`;
    const alertType = alertEvent.type === AlertEventType.DOWN ? 'DOWN' : 'RECOVERY';

    const failures: Array<{ channelId: string; label: string; error: string }> = [];

    // ── d) Deliver to EMAIL channels ──────────────────────────────────────────
    for (const channel of emailChannels) {
      try {
        await this.emailService.sendAlertEmail({
          to: channel.value,
          monitorName: monitor.name,
          monitorUrl: monitor.url,
          type: alertType,
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
        failures.push({ channelId: channel.id, label: channel.value, error: message });
      }
    }

    // ── e) Deliver to WEBHOOK channels ────────────────────────────────────────
    for (const channel of webhookChannels) {
      const deliveryStart = Date.now();
      let deliveryStatusCode: number | undefined;
      let deliveryError: string | undefined;
      let success = false;

      try {
        await this.webhookService.sendWebhookAlert({
          url: channel.value,
          secret: channel.secret ?? undefined,
          monitorId: monitor.id,
          monitorName: monitor.name,
          monitorUrl: monitor.url,
          type: alertType,
          triggeredAt: alertEvent.triggeredAt,
          responseTimeMs,
          errorMessage,
          statusCode: httpStatusCode,
        });

        success = true;
        this.logger.log(
          `Webhook delivered — channelId=${channel.id} url=${channel.value.slice(0, 100)} type=${alertEvent.type}`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        deliveryError = message;
        deliveryStatusCode = error instanceof WebhookResponseError ? error.statusCode : undefined;

        this.logger.error(
          `Webhook delivery failed — channelId=${channel.id} url=${channel.value.slice(0, 100)}: ${message}`,
        );
        failures.push({
          channelId: channel.id,
          label: channel.value.slice(0, 100),
          error: message,
        });
      }

      const elapsedMs = Date.now() - deliveryStart;

      // Write delivery log without blocking the main flow
      void this.prisma.webhookDeliveryLog
        .create({
          data: {
            alertChannelId: channel.id,
            alertEventId,
            url: channel.value,
            statusCode: deliveryStatusCode ?? null,
            responseTimeMs: elapsedMs,
            success,
            errorMessage: deliveryError ?? null,
          },
        })
        .catch((error: unknown) => {
          // Log but never let a log write failure crash the delivery job
          this.logger.error(
            `Failed to write WebhookDeliveryLog — channelId=${channel.id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
    }

    // ── f) Update AlertEvent.deliveryStatus based on aggregate result ─────────
    //
    // Strategy: only mark FAILED if EVERY channel failed. If at least one
    // channel delivered the alert (regardless of type), mark SENT. This means
    // a partial success still counts as delivered.
    if (failures.length < totalChannels) {
      await this.prisma.alertEvent.update({
        where: { id: alertEventId },
        data: { deliveryStatus: DeliveryStatus.SENT },
      });

      this.logger.log(
        `Alert delivery complete — alertEventId=${alertEventId} status=SENT ` +
          `delivered=${totalChannels - failures.length}/${totalChannels}`,
      );
    } else {
      // Every channel failed — mark FAILED and throw so BullMQ retries the job.
      await this.prisma.alertEvent.update({
        where: { id: alertEventId },
        data: { deliveryStatus: DeliveryStatus.FAILED },
      });

      const failedLabels = failures.map((f) => f.label).join(', ');
      this.logger.error(
        `Alert delivery failed for all channels — alertEventId=${alertEventId} channels=${failedLabels}`,
      );

      throw new Error(
        `Delivery failed for alertEventId=${alertEventId} on all ${totalChannels} channels: ${failedLabels}`,
      );
    }
  }
}
