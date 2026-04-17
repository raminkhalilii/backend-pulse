import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsString,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

/**
 * Body for PUT /monitors/:monitorId/alert-settings.
 *
 * Cross-field business rules (escalationThreshold > alertThreshold,
 * quietHoursStart/End required when enabled, etc.) are enforced in
 * AlertSettingsService rather than here so the DTO stays structurally clean.
 */
export class UpsertAlertSettingsDto {
  /** Number of consecutive DOWN heartbeats before the first alert fires. */
  @IsInt()
  @Min(1)
  @Max(10)
  alertThreshold!: number;

  /**
   * Consecutive failures required before an escalation alert fires.
   * Must be greater than alertThreshold (validated in service).
   */
  @IsInt()
  @Min(2)
  @Max(20)
  escalationThreshold!: number;

  /** Whether to send a RECOVERY notification when the monitor comes back UP. */
  @IsBoolean()
  alertOnRecovery!: boolean;

  @IsBoolean()
  quietHoursEnabled!: boolean;

  /** UTC start of the quiet window in "HH:MM" format. Required when quietHoursEnabled=true. */
  @ValidateIf((o: UpsertAlertSettingsDto) => o.quietHoursEnabled)
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'quietHoursStart must be a valid UTC time in HH:MM format (e.g. "22:00")',
  })
  quietHoursStart?: string;

  /** UTC end of the quiet window in "HH:MM" format. Required when quietHoursEnabled=true. */
  @ValidateIf((o: UpsertAlertSettingsDto) => o.quietHoursEnabled)
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'quietHoursEnd must be a valid UTC time in HH:MM format (e.g. "08:00")',
  })
  quietHoursEnd?: string;

  /**
   * Days of the week (UTC) on which quiet hours apply.
   * Values: 0 (Sunday) through 6 (Saturday). No duplicates.
   * Must contain at least one entry when quietHoursEnabled=true (enforced in service).
   */
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  @ArrayUnique()
  quietHoursDays!: number[];
}
