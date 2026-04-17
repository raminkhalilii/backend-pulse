import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma';
import { AlertSettingsController } from './alert-settings.controller';
import { AlertSettingsService } from './alert-settings.service';
import { QuietHoursService } from './quiet-hours.service';

/**
 * AlertSettingsModule provides per-monitor alert configuration:
 *  - AlertSettingsService  — settings CRUD, channel routing, threshold resolution
 *  - QuietHoursService     — pure-UTC quiet-window logic
 *
 * Imported by:
 *  - AlertModule      → AlertEngineService uses the services for threshold / quiet hours
 *  - NotificationModule → AlertDeliveryConsumer uses AlertSettingsService for channel routing
 *
 * The HTTP controller (AlertSettingsController) becomes active in any process
 * that includes this module in its NestJS application tree (i.e. the API process
 * via NotificationModule → AlertSettingsModule). It is harmlessly passive in the
 * worker process which has no HTTP server.
 */
@Module({
  controllers: [AlertSettingsController],
  providers: [AlertSettingsService, QuietHoursService, PrismaService],
  exports: [AlertSettingsService, QuietHoursService],
})
export class AlertSettingsModule {}
