import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma';
import { ALERT_DELIVERY_QUEUE } from '../queue/queue.constants';
import { AlertEngineService } from './alert-engine.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: ALERT_DELIVERY_QUEUE,
      // Retry config on the producer side so every job inherits these defaults
      // when AlertEngineService calls queue.add().
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    }),
  ],
  providers: [AlertEngineService, PrismaService],
  exports: [AlertEngineService],
})
export class AlertModule {}
