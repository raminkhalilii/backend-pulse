import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { MonitorModule } from '../monitor/monitor.module';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [
    ScheduleModule.forRoot(), // registers the global cron/interval/timeout scheduler
    MonitorModule, // provides MonitorService + MonitorDispatcherService
  ],
  providers: [SchedulerService],
})
export class SchedulerModule {}
