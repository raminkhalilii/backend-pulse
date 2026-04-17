import { Body, Controller, Get, HttpCode, HttpStatus, Param, Put, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { GetUserId } from '../auth/get-user.decorator';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { AlertSettingsService } from './alert-settings.service';
import { UpsertAlertSettingsDto } from './dto/upsert-alert-settings.dto';

/** Body shape for the PUT /channels endpoint. */
class SetChannelsDto {
  channelIds!: string[];
  escalationChannelIds!: string[];
}

@ApiTags('alert-settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('monitors/:monitorId/alert-settings')
export class AlertSettingsController {
  constructor(private readonly alertSettingsService: AlertSettingsService) {}

  // ── GET /monitors/:monitorId/alert-settings ────────────────────────────────

  @Get()
  @ApiOperation({
    summary: 'Get alert settings + channel routing for a monitor',
    description:
      'Returns the MonitorAlertSettings record plus normal and escalation channels ' +
      'as separate arrays. If no settings record exists the caller receives null for ' +
      'settings (the engine uses safe defaults in that case).',
  })
  @ApiParam({ name: 'monitorId', description: 'Monitor UUID' })
  @ApiResponse({ status: 200, description: 'Settings object (may be null) + channel arrays.' })
  @ApiResponse({ status: 403, description: 'Not the owner of this monitor.' })
  @ApiResponse({ status: 404, description: 'Monitor not found.' })
  async getSettings(
    @Param('monitorId') monitorId: string,
  ): Promise<{ settings: unknown; channels: unknown; escalationChannels: unknown }> {
    // Verify ownership via the settings service (reuses the same helper)
    const [settings, channels, escalationChannels] = await Promise.all([
      this.alertSettingsService.getSettingsForMonitor(monitorId),
      this.alertSettingsService.getChannelsForMonitor(monitorId, false),
      this.alertSettingsService.getChannelsForMonitor(monitorId, true),
    ]);

    return { settings, channels, escalationChannels };
  }

  // ── PUT /monitors/:monitorId/alert-settings ────────────────────────────────

  @Put()
  @ApiOperation({
    summary: 'Create or replace alert settings for a monitor',
    description:
      'Upserts the MonitorAlertSettings record. ' +
      'escalationThreshold must be > alertThreshold. ' +
      'quietHoursStart / quietHoursEnd / quietHoursDays are required when quietHoursEnabled=true.',
  })
  @ApiParam({ name: 'monitorId', description: 'Monitor UUID' })
  @ApiBody({ type: UpsertAlertSettingsDto })
  @ApiResponse({ status: 200, description: 'Updated MonitorAlertSettings record.' })
  @ApiResponse({ status: 400, description: 'Validation error (cross-field rules).' })
  @ApiResponse({ status: 403, description: 'Not the owner of this monitor.' })
  @ApiResponse({ status: 404, description: 'Monitor not found.' })
  async upsertSettings(
    @Param('monitorId') monitorId: string,
    @Body() dto: UpsertAlertSettingsDto,
    @GetUserId() userId: string,
  ): Promise<unknown> {
    return this.alertSettingsService.upsertSettingsForMonitor(monitorId, userId, dto);
  }

  // ── PUT /monitors/:monitorId/alert-settings/channels ─────────────────────

  @Put('channels')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Set which alert channels receive notifications for this monitor',
    description:
      'Replaces the full set of MonitorAlertChannel links atomically. ' +
      'channelIds: channels that receive every alert for this monitor. ' +
      'escalationChannelIds: extra channels that fire only once consecutiveFailures ' +
      'reaches escalationThreshold. ' +
      'Pass empty arrays to remove all routing (engine falls back to all user channels).',
  })
  @ApiParam({ name: 'monitorId', description: 'Monitor UUID' })
  @ApiResponse({
    status: 200,
    description: '{ success: true, channelCount: number }',
  })
  @ApiResponse({ status: 403, description: 'Not the owner of this monitor or channel.' })
  @ApiResponse({ status: 404, description: 'Monitor not found.' })
  async setChannels(
    @Param('monitorId') monitorId: string,
    @Body() body: SetChannelsDto,
    @GetUserId() userId: string,
  ): Promise<{ success: boolean; channelCount: number }> {
    const channelIds = body.channelIds ?? [];
    const escalationChannelIds = body.escalationChannelIds ?? [];

    await this.alertSettingsService.setChannelsForMonitor(
      monitorId,
      userId,
      channelIds,
      escalationChannelIds,
    );

    return { success: true, channelCount: channelIds.length + escalationChannelIds.length };
  }

  // ── GET /monitors/:monitorId/alert-settings/suppressed ───────────────────

  @Get('suppressed')
  @ApiOperation({
    summary: 'Get recent suppressed alerts for a monitor',
    description:
      'Returns the last 20 SuppressedAlert records for this monitor, newest first. ' +
      'Useful for showing the user "N alerts were suppressed last night during quiet hours".',
  })
  @ApiParam({ name: 'monitorId', description: 'Monitor UUID' })
  @ApiResponse({ status: 200, description: 'Array of SuppressedAlert records (max 20).' })
  @ApiResponse({ status: 403, description: 'Not the owner of this monitor.' })
  @ApiResponse({ status: 404, description: 'Monitor not found.' })
  async getSuppressed(@Param('monitorId') monitorId: string): Promise<unknown[]> {
    return this.alertSettingsService.getSuppressedAlerts(monitorId, 20);
  }
}
