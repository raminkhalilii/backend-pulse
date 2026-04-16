import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateAlertChannelDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;
}
