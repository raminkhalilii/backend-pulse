import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma';

/** Shape returned by the raw aggregation query. */
interface AggRow {
  monitorId: string;
  hour: Date;
  total: bigint; // COUNT(*) — PostgreSQL returns bigint
  up_count: bigint; // COUNT(CASE WHEN status = 'UP' …)
  avg_latency: string | null; // AVG — Prisma surfaces Decimal as string
}

@Injectable()
export class AggregationService {
  private readonly logger = new Logger(AggregationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Runs every night at 02:00.
   *
   * For every complete hour that is older than 24 hours:
   *   1. Computes uptime % and average latency from raw Heartbeat rows.
   *   2. Upserts one HourlySummary row per (monitorId, hour) pair.
   *   3. Deletes the raw rows — they are no longer needed for display.
   *
   * Everything runs inside a single transaction so a crash after upserts
   * but before the delete is safe: the next run will simply re-upsert the
   * same summaries (idempotent) before deleting.
   */
  @Cron('0 0 2 * * *')
  async aggregateOldHeartbeats(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

      await this.prisma.$transaction(async (tx) => {
        // ── Step 1: aggregate ──────────────────────────────────────────────
        const rows = await tx.$queryRaw<AggRow[]>`
          SELECT
            "monitorId",
            DATE_TRUNC('hour', timestamp)                             AS hour,
            COUNT(*)::bigint                                          AS total,
            COUNT(CASE WHEN status::text = 'UP' THEN 1 END)::bigint  AS up_count,
            AVG("latencyMs")                                          AS avg_latency
          FROM "Heartbeat"
          WHERE timestamp < ${cutoff}
          GROUP BY "monitorId", DATE_TRUNC('hour', timestamp)
          ORDER BY "monitorId", hour
        `;

        if (rows.length === 0) {
          this.logger.log('Aggregation: no heartbeats older than 24 h — nothing to do');
          return;
        }

        // ── Step 2: upsert summaries ───────────────────────────────────────
        for (const row of rows) {
          const uptimePercent =
            row.total > 0n ? (Number(row.up_count) / Number(row.total)) * 100 : 0;
          const avgLatencyMs =
            row.avg_latency === null ? 0 : Number.parseFloat(String(row.avg_latency));

          await tx.hourlySummary.upsert({
            where: {
              monitorId_hour: { monitorId: row.monitorId, hour: row.hour },
            },
            create: {
              monitorId: row.monitorId,
              hour: row.hour,
              uptimePercent,
              avgLatencyMs,
            },
            update: { uptimePercent, avgLatencyMs },
          });
        }

        // ── Step 3: delete the raw rows ────────────────────────────────────
        const { count } = await tx.heartbeat.deleteMany({
          where: { timestamp: { lt: cutoff } },
        });

        this.logger.log(
          `Aggregation complete: ${rows.length} hour bucket(s) summarised, ${count} raw heartbeat(s) deleted`,
        );
      });
    } catch (error) {
      this.logger.error('Nightly aggregation failed', (error as Error).stack);
    }
  }
}
