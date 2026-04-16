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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { GetUserId } from '../auth/get-user.decorator';
import { AlertChannelService } from './alert-channel.service';
import { CreateAlertChannelDto } from './dto/create-alert-channel.dto';
import { UpdateAlertChannelDto } from './dto/update-alert-channel.dto';

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
  @ApiResponse({ status: 200, description: 'Array of alert channels.' })
  findAll(@GetUserId() userId: string) {
    return this.alertChannelService.findAll(userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update label or enabled state of an alert channel' })
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
  @ApiOperation({ summary: 'Send a test alert to verify the channel is working' })
  @ApiResponse({ status: 204, description: 'Test alert sent.' })
  @ApiResponse({ status: 403, description: 'Not the owner of this channel.' })
  @ApiResponse({ status: 404, description: 'Channel not found.' })
  sendTest(@Param('id') id: string, @GetUserId() userId: string) {
    return this.alertChannelService.sendTest(id, userId);
  }
}
