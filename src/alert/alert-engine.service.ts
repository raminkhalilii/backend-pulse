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
import { ALERT_DELIVERY_QUEUE } from '../queue/queue.constants';

export interface AlertDeliveryPayload {
  alertEventId: string;
  monitorId: string;
  type: AlertEventType;
}

@Injectable()
export class AlertEngineService {
  private readonly logger = new Logger(AlertEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(ALERT_DELIVERY_QUEUE) private readonly alertQueue: Queue,
  ) {}

  async processHeartbeat(heartbeat: Heartbeat, monitor: Monitor): Promise<void> {
    const { status } = heartbeat;
    const { id: monitorId, lastStatus, consecutiveFailures, alertThreshold } = monitor;

    // ── a) Consecutive failure tracking ──────────────────────────────────────
    const createConsecutiveFailures = status === PingStatus.DOWN ? consecutiveFailures + 1 : 0;

    // ── b) State transition detection ─────────────────────────────────────────
    // Recovery: monitor just came back UP after being DOWN
    const isRecovery = status === PingStatus.UP && lastStatus === PingStatus.DOWN;

    // shouldCheckDownAlert: status is DOWN and we've accumulated enough failures.
    // The dedup query inside the transaction acts as the "first occurrence" gate,
    // replacing the isNewOutage flag (which has a logical contradiction for
    // alertThreshold > 1 — see plan for details).
    const shouldCheckDownAlert =
      status === PingStatus.DOWN && createConsecutiveFailures >= alertThreshold;

    // ── c + d + e + f) Atomic block ───────────────────────────────────────────
    // The transaction returns the fired alert payload (or null if no alert was
    // triggered). Returning a value — rather than mutating outer let variables —
    // lets TypeScript's control flow analysis track the type correctly after the
    // async callback completes.
    const firedAlert = await this.prisma.$transaction(
      async (tx): Promise<AlertDeliveryPayload | null> => {
        // ── DOWN path ───────────────────────────────────────────────────────
        if (shouldCheckDownAlert) {
          // d) Dedup: find the most recent AlertEvent for this monitor.
          //    If it is a DOWN (with no RECOVERY after it), an outage is already
          //    open — skip creating a duplicate.
          const mostRecent = await tx.alertEvent.findFirst({
            where: { monitorId },
            orderBy: { triggeredAt: 'desc' },
          });
          const openOutageExists = mostRecent?.type === AlertEventType.DOWN;

          if (!openOutageExists) {
            // e) Create the DOWN AlertEvent
            const evt = await tx.alertEvent.create({
              data: {
                monitorId,
                type: AlertEventType.DOWN,
                deliveryStatus: DeliveryStatus.PENDING,
                metadata: {
                  consecutiveFailures: createConsecutiveFailures,
                  latencyMs: heartbeat.latencyMs,
                },
              },
            });

            // f) Update monitor atomically with the AlertEvent creation
            await tx.monitor.update({
              where: { id: monitorId },
              data: {
                consecutiveFailures: createConsecutiveFailures,
                lastStatus: status,
                lastAlertedAt: new Date(),
              },
            });

            return { alertEventId: evt.id, monitorId, type: AlertEventType.DOWN };
          }
        }

        // ── RECOVERY path ────────────────────────────────────────────────────
        if (isRecovery) {
          const evt = await tx.alertEvent.create({
            data: {
              monitorId,
              type: AlertEventType.RECOVERY,
              deliveryStatus: DeliveryStatus.PENDING,
              metadata: {
                latencyMs: heartbeat.latencyMs,
              },
            },
          });

          // f) Update monitor atomically with the AlertEvent creation
          await tx.monitor.update({
            where: { id: monitorId },
            data: {
              consecutiveFailures: createConsecutiveFailures,
              lastStatus: status,
              lastAlertedAt: new Date(),
            },
          });

          return { alertEventId: evt.id, monitorId, type: AlertEventType.RECOVERY };
        }

        // f) No alert fired — still update consecutive failures and last status
        await tx.monitor.update({
          where: { id: monitorId },
          data: {
            consecutiveFailures: createConsecutiveFailures,
            lastStatus: status,
          },
        });

        return null;
      },
    );

    // ── g) Enqueue delivery job ───────────────────────────────────────────────
    // Done outside the transaction so a Redis failure doesn't roll back the DB
    // writes. If enqueue fails, the AlertEvent remains PENDING and can be
    // retried by a background sweep later.
    if (firedAlert !== null) {
      try {
        await this.alertQueue.add('deliver-alert', firedAlert satisfies AlertDeliveryPayload);

        this.logger.log(
          `Alert enqueued — monitorId=${firedAlert.monitorId} type=${firedAlert.type} alertEventId=${firedAlert.alertEventId}`,
        );
      } catch (error) {
        // Do NOT rethrow. The AlertEvent stays PENDING in the DB so a future
        // retry sweep can pick it up without losing the audit record.
        this.logger.error(
          `Failed to enqueue alert-delivery for alertEventId=${firedAlert.alertEventId}: ${(error as Error).message}`,
        );
      }
    }
  }
}
