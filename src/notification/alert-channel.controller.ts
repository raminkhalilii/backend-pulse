import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { GetUserId } from '../auth/get-user.decorator';
import { AlertChannelService } from './alert-channel.service';
import { CreateAlertChannelDto } from './dto/create-alert-channel.dto';
import { UpdateAlertChannelDto } from './dto/update-alert-channel.dto';
import { WebhookLogsQueryDto } from './dto/webhook-logs-query.dto';

@ApiTags('alert-channels')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('alert-channels')
export class AlertChannelController {
  constructor(private readonly alertChannelService: AlertChannelService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new alert channel for the authenticated user' })
  @ApiResponse({ status: 201, description: 'Channel created successfully.' })
  @ApiResponse({ status: 400, description: 'Validation failed (e.g. invalid email).' })
  @ApiResponse({ status: 403, description: 'Free-plan channel limit reached.' })
  create(@Body() dto: CreateAlertChannelDto, @GetUserId() userId: string) {
    return this.alertChannelService.create(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all alert channels for the authenticated user' })
  @ApiResponse({ status: 200, description: 'Array of alert channels (secret field omitted).' })
  findAll(@GetUserId() userId: string) {
    return this.alertChannelService.findAll(userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update label, enabled state, or secret of an alert channel' })
  @ApiResponse({ status: 200, description: 'Channel updated.' })
  @ApiResponse({ status: 403, description: 'Not the owner of this channel.' })
  @ApiResponse({ status: 404, description: 'Channel not found.' })
  update(@Param('id') id: string, @Body() dto: UpdateAlertChannelDto, @GetUserId() userId: string) {
    return this.alertChannelService.update(id, userId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an alert channel' })
  @ApiResponse({ status: 204, description: 'Channel deleted.' })
  @ApiResponse({ status: 403, description: 'Not the owner of this channel.' })
  @ApiResponse({ status: 404, description: 'Channel not found.' })
  remove(@Param('id') id: string, @GetUserId() userId: string) {
    return this.alertChannelService.remove(id, userId);
  }

  @Post(':id/test')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Send a test alert email to verify an EMAIL channel is working' })
  @ApiResponse({ status: 204, description: 'Test alert sent.' })
  @ApiResponse({ status: 403, description: 'Not the owner of this channel.' })
  @ApiResponse({ status: 404, description: 'Channel not found.' })
  sendTest(@Param('id') id: string, @GetUserId() userId: string) {
    return this.alertChannelService.sendTest(id, userId);
  }

  @Post(':id/test-webhook')
  @ApiOperation({
    summary: 'Fire a test payload to a WEBHOOK channel to verify delivery',
    description:
      'Sends a synthetic monitor.test event to the configured webhook URL. ' +
      'Applies full SSRF protection. Does not create any AlertEvent or log record. ' +
      'Returns delivery outcome — never throws on webhook-side failures.',
  })
  @ApiResponse({
    status: 200,
    description: 'Test result: { success, statusCode, responseTimeMs }',
  })
  @ApiResponse({
    status: 400,
    description: 'Channel is not WEBHOOK type or URL is blocked by SSRF protection.',
  })
  @ApiResponse({ status: 403, description: 'Not the owner of this channel.' })
  @ApiResponse({ status: 404, description: 'Channel not found.' })
  testWebhook(@Param('id') id: string, @GetUserId() userId: string) {
    return this.alertChannelService.testWebhookChannel(id, userId);
  }

  @Post(':id/test-slack')
  @ApiOperation({
    summary: 'Fire a test Slack Block Kit message to verify a SLACK channel',
    description:
      'Sends a synthetic DOWN alert to the configured Slack Incoming Webhook URL. ' +
      'Validates that the URL is a Slack webhook before sending. ' +
      'Does not create any AlertEvent or log record. ' +
      'Returns { success, error? } — never throws on delivery-side failures.',
  })
  @ApiResponse({ status: 200, description: 'Test result: { success, error? }' })
  @ApiResponse({ status: 400, description: 'Channel is not SLACK type or URL is invalid.' })
  @ApiResponse({ status: 403, description: 'Not the owner of this channel.' })
  @ApiResponse({ status: 404, description: 'Channel not found.' })
  testSlack(@Param('id') id: string, @GetUserId() userId: string) {
    return this.alertChannelService.testSlackChannel(id, userId);
  }

  @Post(':id/test-discord')
  @ApiOperation({
    summary: 'Fire a test Discord Embed message to verify a DISCORD channel',
    description:
      'Sends a synthetic DOWN alert embed to the configured Discord webhook URL. ' +
      'Validates that the URL is a Discord webhook before sending. ' +
      'Does not create any AlertEvent or log record. ' +
      'Returns { success, error? } — never throws on delivery-side failures.',
  })
  @ApiResponse({ status: 200, description: 'Test result: { success, error? }' })
  @ApiResponse({ status: 400, description: 'Channel is not DISCORD type or URL is invalid.' })
  @ApiResponse({ status: 403, description: 'Not the owner of this channel.' })
  @ApiResponse({ status: 404, description: 'Channel not found.' })
  testDiscord(@Param('id') id: string, @GetUserId() userId: string) {
    return this.alertChannelService.testDiscordChannel(id, userId);
  }

  @Get(':id/webhook-logs')
  @ApiOperation({
    summary: 'Get delivery logs for a channel (WEBHOOK, SLACK, or DISCORD)',
    description:
      'Returns delivery attempts ordered newest-first. Use limit/offset for pagination. ' +
      'The platformType field distinguishes WEBHOOK vs SLACK vs DISCORD entries.',
  })
  @ApiResponse({ status: 200, description: 'Array of WebhookDeliveryLog records.' })
  @ApiResponse({ status: 403, description: 'Not the owner of this channel.' })
  @ApiResponse({ status: 404, description: 'Channel not found.' })
  getWebhookLogs(
    @Param('id') id: string,
    @Query() query: WebhookLogsQueryDto,
    @GetUserId() userId: string,
  ) {
    return this.alertChannelService.getWebhookLogs(
      id,
      userId,
      query.limit ?? 20,
      query.offset ?? 0,
    );
  }
}
