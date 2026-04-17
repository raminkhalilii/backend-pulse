import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateAlertChannelDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  /**
   * Update or clear the HMAC signing secret for a WEBHOOK channel.
   * Pass an empty string or null to remove the secret.
   */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  secret?: string | null;
}
