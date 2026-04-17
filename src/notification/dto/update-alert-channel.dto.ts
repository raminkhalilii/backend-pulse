import { IsBoolean, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { DiscordPlatformMetadata, SlackPlatformMetadata } from './create-alert-channel.dto';

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

  /**
   * Update or clear the platform display metadata for SLACK or DISCORD channels.
   * Pass null to remove the metadata.
   */
  @IsOptional()
  @IsObject()
  platformMetadata?: SlackPlatformMetadata | DiscordPlatformMetadata | null;
}
