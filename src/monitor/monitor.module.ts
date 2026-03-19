import { Module } from '@nestjs/common';
import { MonitorService } from './monitor.service';
import { MonitorController } from './monitor.controller';
import { MONITOR_REPOSITORY_TOKEN } from './monitor.repository.interface';
import { MonitorRepository } from '../database/monitor.repository';
import { PrismaService } from '../../prisma/prisma';

@Module({
  controllers: [MonitorController],
  providers: [
    MonitorService,
    PrismaService,
    {
      provide: MONITOR_REPOSITORY_TOKEN,
      useClass: MonitorRepository,
    },
  ],
  exports: [MonitorService],
})
export class MonitorModule {}
