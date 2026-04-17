import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  AlertEventType,
  DeliveryStatus,
  Heartbeat,
  Monitor,
  PingStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma';
import { AlertSettingsService } from '../alert-settings/alert-settings.service';
import { QuietHoursService } from '../alert-settings/quiet-hours.service';
import { ALERT_DELIVERY_QUEUE } from '../queue/queue.constants';

export interface AlertDeliveryPayload {
  alertEventId: string;
  monitorId: string;
  type: AlertEventType;
  /** true when this job targets escalation channels only */
  isEscalation?: boolean;
}

@Injectable()
export class AlertEngineService {
  private readonly logger = new Logger(AlertEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly alertSettingsService: AlertSettingsService,
    private readonly quietHoursService: QuietHoursService,
    @InjectQueue(ALERT_DELIVERY_QUEUE) private readonly alertQueue: Queue,
  ) {}

  async processHeartbeat(heartbeat: Heartbeat, monitor: Monitor): Promise<void> {
    const { status } = heartbeat;
    const { id: monitorId, lastStatus, consecutiveFailures } = monitor;

    // ── a) Load per-monitor settings (null → engine uses safe defaults) ───────
    const settings = await this.alertSettingsService.getSettingsForMonitor(monitorId);
    const effectiveThreshold = settings?.alertThreshold ?? monitor.alertThreshold;
    const escalationThreshold = settings?.escalationThreshold ?? 5;

    // ── b) Consecutive failure tracking ───────────────────────────────────────
    const nextConsecutiveFailures = status === PingStatus.DOWN ? consecutiveFailures + 1 : 0;

    // ── c) State-transition flags ─────────────────────────────────────────────
    const isRecovery = status === PingStatus.UP && lastStatus === PingStatus.DOWN;
    const shouldCheckDownAlert =
      status === PingStatus.DOWN && nextConsecutiveFailures >= effectiveThreshold;

    // ── d) Quiet-hours gate ───────────────────────────────────────────────────
    // Applies to any heartbeat that WOULD produce an AlertEvent. If suppressed,
    // we still advance consecutiveFailures and write a SuppressedAlert audit row.
    const inQuietHours = settings ? this.quietHoursService.isInQuietHours(settings) : false;

    if (inQuietHours && (shouldCheckDownAlert || isRecovery)) {
      this.logger.warn(
        `Alert suppressed for monitor ${monitorId} — quiet hours active` +
          (settings?.quietHoursEnd ? ` (resumes at ${settings.quietHoursEnd} UTC)` : ''),
      );

      await this.prisma.monitor.update({
        where: { id: monitorId },
        data: { consecutiveFailures: nextConsecutiveFailures, lastStatus: status },
      });

      // Fire-and-forget audit log — never let this mask the heartbeat
      void this.prisma.suppressedAlert
        .create({
          data: {
            monitorId,
            type: isRecovery ? AlertEventType.RECOVERY : AlertEventType.DOWN,
            reason: 'quiet_hours',
            quietHoursEnd: settings?.quietHoursEnd ?? null,
          },
        })
        .catch((error: unknown) => {
          this.logger.error(
            `Failed to write SuppressedAlert for monitorId=${monitorId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });

      return;
    }

    // ── e) Pre-fetch escalation channels (outside transaction for scope clarity) ─
    // Only bother if the current heartbeat could trigger both a DOWN alert AND
    // the escalation threshold.
    const shouldCheckEscalation =
      shouldCheckDownAlert && nextConsecutiveFailures >= escalationThreshold;

    const escalationChannels = shouldCheckEscalation
      ? await this.alertSettingsService.getChannelsForMonitor(monitorId, true)
      : [];

    // ── f) Atomic block ───────────────────────────────────────────────────────
    // Returns the list of payloads to enqueue after the transaction commits.
    const firedAlerts = await this.prisma.$transaction(
      async (tx): Promise<AlertDeliveryPayload[]> => {
        // ── DOWN path ─────────────────────────────────────────────────────────
        if (shouldCheckDownAlert) {
          // Dedup: find the most recent AlertEvent for this monitor.
          // If it is already DOWN (no RECOVERY after it), an outage is open — skip.
          const mostRecent = await tx.alertEvent.findFirst({
            where: { monitorId },
            orderBy: { triggeredAt: 'desc' },
          });
          const openOutageExists = mostRecent?.type === AlertEventType.DOWN;

          if (!openOutageExists) {
            const results: AlertDeliveryPayload[] = [];

            // Normal DOWN alert
            const evt = await tx.alertEvent.create({
              data: {
                monitorId,
                type: AlertEventType.DOWN,
                deliveryStatus: DeliveryStatus.PENDING,
                metadata: {
                  consecutiveFailures: nextConsecutiveFailures,
                  latencyMs: heartbeat.latencyMs,
                },
              },
            });

            await tx.monitor.update({
              where: { id: monitorId },
              data: {
                consecutiveFailures: nextConsecutiveFailures,
                lastStatus: status,
                lastAlertedAt: new Date(),
              },
            });

            results.push({
              alertEventId: evt.id,
              monitorId,
              type: AlertEventType.DOWN,
              isEscalation: false,
            });

            // ── Escalation path ───────────────────────────────────────────────
            // Fires in the same transaction only when the DOWN alert itself fires
            // AND escalation channels are configured.
            if (escalationChannels.length > 0) {
              const escalEvt = await tx.alertEvent.create({
                data: {
                  monitorId,
                  type: AlertEventType.DOWN,
                  deliveryStatus: DeliveryStatus.PENDING,
                  metadata: {
                    consecutiveFailures: nextConsecutiveFailures,
                    latencyMs: heartbeat.latencyMs,
                    isEscalation: true,
                  },
                },
              });

              results.push({
                alertEventId: escalEvt.id,
                monitorId,
                type: AlertEventType.DOWN,
                isEscalation: true,
              });
            }

            return results;
          }
        }

        // ── RECOVERY path ─────────────────────────────────────────────────────
        if (isRecovery) {
          // g) Recovery gate: if alertOnRecovery is disabled, reset state silently.
          if (settings && !settings.alertOnRecovery) {
            await tx.monitor.update({
              where: { id: monitorId },
              data: { consecutiveFailures: nextConsecutiveFailures, lastStatus: status },
            });
            return [];
          }

          const evt = await tx.alertEvent.create({
            data: {
              monitorId,
              type: AlertEventType.RECOVERY,
              deliveryStatus: DeliveryStatus.PENDING,
              metadata: { latencyMs: heartbeat.latencyMs },
            },
          });

          await tx.monitor.update({
            where: { id: monitorId },
            data: {
              consecutiveFailures: nextConsecutiveFailures,
              lastStatus: status,
              lastAlertedAt: new Date(),
            },
          });

          return [
            {
              alertEventId: evt.id,
              monitorId,
              type: AlertEventType.RECOVERY,
              isEscalation: false,
            },
          ];
        }

        // ── No alert — still update consecutive failures and last status ───────
        await tx.monitor.update({
          where: { id: monitorId },
          data: { consecutiveFailures: nextConsecutiveFailures, lastStatus: status },
        });

        return [];
      },
    );

    // ── h) Enqueue delivery jobs ───────────────────────────────────────────────
    // Done outside the transaction so a Redis failure doesn't roll back DB writes.
    // If enqueue fails, the AlertEvent remains PENDING and can be retried later.
    for (const payload of firedAlerts) {
      try {
        await this.alertQueue.add('deliver-alert', payload satisfies AlertDeliveryPayload);

        this.logger.log(
          `Alert enqueued — monitorId=${payload.monitorId} type=${payload.type}` +
            ` alertEventId=${payload.alertEventId} isEscalation=${payload.isEscalation ?? false}`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to enqueue alert-delivery for alertEventId=${payload.alertEventId}: ${
            (error as Error).message
          }`,
        );
      }
    }
  }
}
