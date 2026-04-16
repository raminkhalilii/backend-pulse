import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { EventsModule } from './events/events.module';
import { MonitorModule } from './monitor/monitor.module';
import { NotificationModule } from './notification/notification.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { UserModule } from './user/user.module';

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST ?? 'localhost',
        port: Number.parseInt(process.env.REDIS_PORT ?? '6379', 10),
        password: process.env.REDIS_PASSWORD,
      },
    }),
    UserModule,
    AuthModule,
    MonitorModule,
    SchedulerModule,
    EventsModule,
    NotificationModule, // Registers AlertChannelController + AlertDeliveryConsumer
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
