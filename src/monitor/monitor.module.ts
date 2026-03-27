import { Module } from '@nestjs/common';
import { MonitorDispatcherService } from './monitor-dispatcher.service';
import { MonitorController } from './monitor.controller';
import { MONITOR_REPOSITORY_TOKEN } from './monitor.repository.interface';
import { MonitorService } from './monitor.service';
import { MonitorRepository } from '../database/monitor.repository';
import { QueueModule } from '../queue/queue.module';
import { PrismaService } from '../../prisma/prisma';

@Module({
  imports: [QueueModule],
  controllers: [MonitorController],
  providers: [
    MonitorService,
    MonitorDispatcherService,
    PrismaService,
    {
      provide: MONITOR_REPOSITORY_TOKEN,
      useClass: MonitorRepository,
    },
  ],
  exports: [MonitorService, MonitorDispatcherService],
})
export class MonitorModule {}
