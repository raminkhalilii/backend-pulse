import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma';
import { MONITOR_QUEUE } from '../queue/queue.constants';
import { MonitorProcessor } from './processors/monitor.processor';
import { RedisPublisherService } from './redis-publisher.service';

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST ?? 'localhost',
        port: Number.parseInt(process.env.REDIS_PORT ?? '6379', 10),
        password: process.env.REDIS_PASSWORD,
      },
    }),
    BullModule.registerQueue({ name: MONITOR_QUEUE }),
  ],
  providers: [MonitorProcessor, PrismaService, RedisPublisherService],
})
export class WorkerModule {}
