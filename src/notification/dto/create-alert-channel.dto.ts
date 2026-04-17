import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import { AlertChannelType } from '../../../generated/prisma/client';

/**
 * Optional display metadata stored alongside SLACK and DISCORD channels.
 * These labels are shown in the UI to help users identify channels at a glance —
 * they are not used for delivery.
 */
export interface SlackPlatformMetadata {
  workspaceName?: string;
  channelName?: string;
}

export interface DiscordPlatformMetadata {
  serverName?: string;
  channelName?: string;
}

/**
 * Custom decorator: validates that `value` is a well-formed email address
 * when the sibling `type` field equals EMAIL. Other channel types have no
 * format constraint on `value` in this phase.
 */
function IsEmailIfEmailType(options?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isEmailIfEmailType',
      target: (object as { constructor: new (...args: unknown[]) => unknown }).constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          const dto = args.object as CreateAlertChannelDto;
          if (dto.type !== AlertChannelType.EMAIL) return true;
          if (typeof value !== 'string') return false;
          return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
        },
        defaultMessage(): string {
          return 'value must be a valid email address when type is EMAIL';
        },
      },
    });
  };
}

export class CreateAlertChannelDto {
  @IsEnum(AlertChannelType)
  type: AlertChannelType;

  @IsString()
  @MaxLength(255)
  @IsEmailIfEmailType()
  value: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  /**
   * Optional HMAC-SHA256 signing secret for WEBHOOK channels.
   * When set, every outgoing request will include an
   * X-Pulse-Signature: sha256=<hex> header so the receiving server
   * can verify the payload is genuinely from Pulse.
   */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  secret?: string;

  /**
   * Optional platform-specific display metadata.
   * SLACK channels: { workspaceName?, channelName? }
   * DISCORD channels: { serverName?, channelName? }
   * Not used for delivery — for display purposes only.
   */
  @IsOptional()
  @IsObject()
  platformMetadata?: SlackPlatformMetadata | DiscordPlatformMetadata;
}
