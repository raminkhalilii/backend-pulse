import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma';
import { ALERT_DELIVERY_QUEUE } from '../queue/queue.constants';
import { AlertEngineService } from './alert-engine.service';

@Module({
  imports: [BullModule.registerQueue({ name: ALERT_DELIVERY_QUEUE })],
  providers: [AlertEngineService, PrismaService],
  exports: [AlertEngineService],
})
export class AlertModule {}
