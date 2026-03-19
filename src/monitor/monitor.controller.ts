import { Controller, Post, Body, Patch, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { CreateMonitorDto } from '../auth/dto/create-monitor-dto';
import { UpdateMonitorDto } from '../auth/dto/update-monitor-dto';
import { GetUserId } from '../auth/get-user.decorator';
import { MonitorService } from './monitor.service';

@ApiTags('monitors') // Groups in Swagger
@ApiBearerAuth() // Adds the lock icon in Swagger to input the JWT
@UseGuards(JwtAuthGuard) // Protects EVERY route in this controller!
@Controller('monitors')
export class MonitorController {
  constructor(private readonly monitorService: MonitorService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new monitor' })
  @ApiResponse({ status: 201, description: 'Monitor successfully created.' })
  @ApiResponse({ status: 400, description: 'Bad Request (Validation failed or SSRF prevented).' })
  create(@Body() createMonitorDto: CreateMonitorDto, @GetUserId() userId: string) {
    // We pass both the validated body AND the securely extracted user ID to the service
    return this.monitorService.create(userId, createMonitorDto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an existing monitor' })
  @ApiResponse({ status: 200, description: 'Monitor successfully updated.' })
  @ApiResponse({ status: 404, description: 'Monitor not found.' })
  update(
    @Param('id') id: string, // Extracts the URL parameter (e.g., /monitors/123)
    @Body() updateMonitorDto: UpdateMonitorDto,
    @GetUserId() userId: string,
  ) {
    // SECURITY: We MUST pass the userId down to the service during an update.
    // The service needs to verify that the monitor being updated actually belongs to this user!
    return this.monitorService.update(id, userId, updateMonitorDto);
  }
}
