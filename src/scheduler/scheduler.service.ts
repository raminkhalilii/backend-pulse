import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MonitorFrequency } from '../../generated/prisma/client';
import { MonitorDispatcherService } from '../monitor/monitor-dispatcher.service';
import { MonitorService } from '../monitor/monitor.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly monitorService: MonitorService,
    private readonly monitorDispatcherService: MonitorDispatcherService,
  ) {}

  /**
   * Fires at second 0 of every minute.
   *
   * Frequency dispatch table:
   *   ONE_MIN   → every tick          (minutes 0-59)
   *   FIVE_MIN  → when minute % 5 = 0  (0, 5, 10 … 55)
   *   THIRTY_MIN→ when minute % 30 = 0 (0, 30)
   */
  @Cron('0 * * * * *')
  async dispatchDueMonitors(): Promise<void> {
    try {
      const minute = new Date().getMinutes();

      const frequencies: MonitorFrequency[] = [MonitorFrequency.ONE_MIN];
      if (minute % 5 === 0) frequencies.push(MonitorFrequency.FIVE_MIN);
      if (minute % 30 === 0) frequencies.push(MonitorFrequency.THIRTY_MIN);

      const monitors = await this.monitorService.findDueMonitors(frequencies);

      if (monitors.length === 0) return;

      await Promise.all(
        monitors.map((m) =>
          this.monitorDispatcherService.dispatchPingJob({ monitorId: m.id, url: m.url }),
        ),
      );

      this.logger.log(
        `Tick @${minute}m — dispatched ${monitors.length} job(s) for [${frequencies.join(', ')}]`,
      );
    } catch (error) {
      this.logger.error('Scheduler tick failed', (error as Error).stack);
    }
  }
}
