import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PingStatus } from '../../../generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma';
import { assertPublicUrl } from '../../common/ssrf.util';
import { MonitorJobPayload } from '../../monitor/monitor-dispatcher.service';
import { MONITOR_QUEUE } from '../../queue/queue.constants';

interface PingResult {
  status: PingStatus;
  latencyMs: number | null;
}

@Processor(MONITOR_QUEUE)
export class MonitorProcessor extends WorkerHost {
  private readonly logger = new Logger(MonitorProcessor.name);
  private static readonly TIMEOUT_MS = 10_000;

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  // ─── BullMQ entry point ────────────────────────────────────────────────────

  async process(job: Job<MonitorJobPayload>): Promise<void> {
    const { monitorId, url } = job.data;
    this.logger.log(`[Job ${job.id}] Processing ping — monitorId=${monitorId} url=${url}`);

    let result: PingResult;

    try {
      // 1. SSRF guard: resolve DNS and reject private/internal IPs before any
      //    outbound HTTP request is made.  Throws if the check fails.
      await assertPublicUrl(url);

      // 2. Perform the HTTP ping (with one automatic retry on network error).
      result = await this.pingWithRetry(url);
    } catch (error) {
      // SSRF block or unrecoverable network failure — record as DOWN with no latency.
      this.logger.warn(`[Job ${job.id}] Blocked/failed: ${(error as Error).message}`);
      result = { status: PingStatus.DOWN, latencyMs: null };
    }

    // 3. Persist the heartbeat regardless of outcome.
    await this.prisma.heartbeat.create({
      data: { monitorId, status: result.status, latencyMs: result.latencyMs },
    });

    this.logger.log(
      `[Job ${job.id}] Done — status=${result.status}, latency=${result.latencyMs ?? 'N/A'}ms`,
    );
  }

  // ─── Retry wrapper ─────────────────────────────────────────────────────────

  /**
   * Attempts a single ping.  On a *network error* (not a timeout or HTTP error
   * status) it retries exactly once.  Timeouts and non-2xx responses are
   * returned as PingResult.DOWN without a retry.
   */
  private async pingWithRetry(url: string): Promise<PingResult> {
    try {
      return await this.ping(url);
    } catch (networkError) {
      this.logger.warn(
        `Network error on first attempt for ${url} — retrying once: ${(networkError as Error).message}`,
      );
      try {
        return await this.ping(url);
      } catch {
        // Both attempts failed — treat as DOWN with no latency.
        return { status: PingStatus.DOWN, latencyMs: null };
      }
    }
  }

  // ─── Core ping ─────────────────────────────────────────────────────────────

  /**
   * Fires a GET request and measures Time-to-First-Byte (TTFB) — the elapsed
   * time from sending the request until response headers are received.
   *
   * Returns:
   *   UP   + latencyMs  → 2xx response received within the timeout
   *   DOWN + latencyMs  → non-2xx response received within the timeout
   *   DOWN + null       → timeout (AbortError); TTFB was never reached
   *
   * Throws on network-level errors (ECONNREFUSED, ENOTFOUND, etc.) so that
   * `pingWithRetry` can decide whether to retry.
   */
  private async ping(url: string): Promise<PingResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), MonitorProcessor.TIMEOUT_MS);
    const start = Date.now();

    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
      });

      // `fetch` resolves as soon as response headers arrive → this is TTFB.
      const latencyMs = Date.now() - start;

      // Discard the body immediately to release the underlying socket.
      await response.body?.cancel();

      const status = response.ok ? PingStatus.UP : PingStatus.DOWN;
      return { status, latencyMs };
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        // Hard timeout — TTFB was never reached.
        return { status: PingStatus.DOWN, latencyMs: null };
      }
      // Network-level error (ECONNREFUSED, ENOTFOUND …) — bubble up for retry.
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
