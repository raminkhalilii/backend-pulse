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
    description: 'The exact URL to be pinged',
    example: 'https://google.com',
  })
  @IsUrl({ require_tld: true, require_protocol: true })
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
