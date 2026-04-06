import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsString, IsUrl } from 'class-validator';

enum MonitorFrequency {
  ONE_MIN = 'ONE_MIN',
  FIVE_MIN = 'FIVE_MIN',
  THIRTY_MIN = 'THIRTY_MIN',
}
export class CreateMonitorDto {
  @ApiProperty({
    description: 'A friendly name for the monitor',
    example: 'Google Homepage',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: 'The URL to be pinged (protocol optional; https:// will be prepended if missing)',
    example: 'google.com or https://api.example.com',
  })
  @IsUrl({ require_tld: true, require_protocol: false })
  @IsNotEmpty()
  url: string;

  @ApiProperty({
    description: 'How often the background worker should ping the URL',
    enum: MonitorFrequency,
    example: MonitorFrequency.ONE_MIN,
  })
  @IsEnum(MonitorFrequency)
  @IsNotEmpty()
  frequency: MonitorFrequency;
}
