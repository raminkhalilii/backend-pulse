import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { MONITOR_QUEUE } from '../queue/queue.constants';

export interface MonitorJobPayload {
  monitorId: string;
  url: string;
}

@Injectable()
export class MonitorDispatcherService {
  private readonly logger = new Logger(MonitorDispatcherService.name);

  constructor(@InjectQueue(MONITOR_QUEUE) private readonly monitorQueue: Queue) {}

  async dispatchPingJob(payload: MonitorJobPayload): Promise<void> {
    await this.monitorQueue.add('ping', payload);
    this.logger.debug(`Dispatched ping job for monitorId=${payload.monitorId}`);
  }
}
