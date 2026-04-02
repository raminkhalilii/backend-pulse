import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { MONITOR_UPDATED_CHANNEL, MonitorUpdatedPayload } from './events.constants';
import { EventsGateway } from './events.gateway';

@Injectable()
export class RedisSubscriberService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisSubscriberService.name);
  private readonly client: Redis;

  constructor(private readonly eventsGateway: EventsGateway) {
    // A Redis client used for SUBSCRIBE cannot issue any other commands,
    // so this is a dedicated connection separate from the BullMQ pool.
    this.client = new Redis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number.parseInt(process.env.REDIS_PORT ?? '6379', 10),
      password: process.env.REDIS_PASSWORD,
      lazyConnect: true,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
    await this.client.subscribe(MONITOR_UPDATED_CHANNEL);

    this.client.on('message', (channel: string, message: string) => {
      if (channel !== MONITOR_UPDATED_CHANNEL) return;
      try {
        const payload = JSON.parse(message) as MonitorUpdatedPayload;
        this.eventsGateway.broadcastMonitorUpdate(payload);
      } catch {
        this.logger.error(`Failed to parse message on channel ${channel}: ${message}`);
      }
    });

    this.logger.log(`Subscribed to Redis channel "${MONITOR_UPDATED_CHANNEL}"`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.unsubscribe(MONITOR_UPDATED_CHANNEL);
    await this.client.quit();
  }
}
