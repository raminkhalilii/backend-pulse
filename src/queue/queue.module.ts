import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { MONITOR_QUEUE } from './queue.constants';

@Module({
  imports: [BullModule.registerQueue({ name: MONITOR_QUEUE })],
  exports: [BullModule],
})
export class QueueModule {}
