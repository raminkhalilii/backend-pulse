import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisPublisherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisPublisherService.name);
  private readonly client: Redis;

  constructor() {
    // Dedicated publisher connection — kept separate from the BullMQ subscriber pool.
    this.client = new Redis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number.parseInt(process.env.REDIS_PORT ?? '6379', 10),
      password: process.env.REDIS_PASSWORD,
      lazyConnect: true,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
    this.logger.log('Redis publisher connected');
  }

  async publish(channel: string, payload: object): Promise<void> {
    await this.client.publish(channel, JSON.stringify(payload));
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
