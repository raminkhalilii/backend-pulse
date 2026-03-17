import { ApiProperty, PartialType } from '@nestjs/swagger';
import { CreateMonitorDto } from './create-monitor-dto';
import { IsBoolean, IsOptional } from 'class-validator';

// PartialType takes the Create DTO and makes all its properties optional automatically!
export class UpdateMonitorDto extends PartialType(CreateMonitorDto) {
  // We add isActive here because a user might want to pause/unpause their monitor
  @ApiProperty({
    description: 'Whether the monitor is actively checking the URL',
    example: false,
    required: false, // Swagger documentation
  })
  @IsOptional() // class-validator
  @IsBoolean()
  isActive?: boolean;
}
