import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma';
import { MonitorModule } from '../monitor/monitor.module';
import { AggregationService } from './aggregation.service';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [ScheduleModule.forRoot(), MonitorModule],
  providers: [
    SchedulerService, // per-minute dispatch cron
    AggregationService, // nightly data aggregation cron
    PrismaService, // needed by AggregationService for raw queries
  ],
})
export class SchedulerModule {}
