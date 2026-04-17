import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AlertChannel, MonitorAlertSettings, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma';
import { UpsertAlertSettingsDto } from './dto/upsert-alert-settings.dto';

@Injectable()
export class AlertSettingsService {
  private readonly logger = new Logger(AlertSettingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Settings CRUD ──────────────────────────────────────────────────────────

  /**
   * Returns the MonitorAlertSettings for a given monitor, or null if no
   * settings record has been created yet.  The caller (AlertEngineService)
   * falls back to Monitor.alertThreshold and safe defaults when null.
   */
  async getSettingsForMonitor(monitorId: string): Promise<MonitorAlertSettings | null> {
    return this.prisma.monitorAlertSettings.findUnique({ where: { monitorId } });
  }

  /**
   * Creates or fully replaces the settings record for a monitor.
   *
   * Validates:
   *  - The monitor belongs to userId.
   *  - escalationThreshold > alertThreshold.
   *  - quietHoursStart / quietHoursEnd are present when quietHoursEnabled=true.
   *  - quietHoursDays is non-empty when quietHoursEnabled=true.
   */
  async upsertSettingsForMonitor(
    monitorId: string,
    userId: string,
    dto: UpsertAlertSettingsDto,
  ): Promise<MonitorAlertSettings> {
    await this.verifyMonitorOwnership(monitorId, userId);
    this.validateSettingsDto(dto);

    const data = {
      alertThreshold: dto.alertThreshold,
      escalationThreshold: dto.escalationThreshold,
      alertOnRecovery: dto.alertOnRecovery,
      quietHoursEnabled: dto.quietHoursEnabled,
      quietHoursStart: dto.quietHoursStart ?? null,
      quietHoursEnd: dto.quietHoursEnd ?? null,
      quietHoursDays: dto.quietHoursDays as unknown as Prisma.InputJsonValue,
    };

    return this.prisma.monitorAlertSettings.upsert({
      where: { monitorId },
      create: { monitorId, ...data },
      update: data,
    });
  }

  // ── Channel routing ────────────────────────────────────────────────────────

  /**
   * Returns the alert channels linked to this monitor via MonitorAlertChannel.
   *
   * @param monitorId  - The monitor whose channels to load.
   * @param escalationOnly - When true, only isEscalation=true channels are returned.
   *
   * Disabled channels (enabled=false) are filtered out; callers always receive
   * only actionable channels.
   */
  async getChannelsForMonitor(monitorId: string, escalationOnly = false): Promise<AlertChannel[]> {
    const links = await this.prisma.monitorAlertChannel.findMany({
      where: {
        monitorId,
        ...(escalationOnly ? { isEscalation: true } : {}),
      },
      include: { alertChannel: true },
    });

    return links.map((l) => l.alertChannel).filter((c): c is AlertChannel => c.enabled);
  }

  /**
   * Atomically replaces the complete set of MonitorAlertChannel records for
   * a monitor.
   *
   * Steps:
   *   1. Verify monitor ownership.
   *   2. Validate all channelIds belong to userId.
   *   3. Transaction: delete existing → insert new.
   *
   * If any channelId is not owned by the user the whole operation is rejected
   * before any writes occur.
   */
  async setChannelsForMonitor(
    monitorId: string,
    userId: string,
    channelIds: string[],
    escalationChannelIds: string[],
  ): Promise<void> {
    await this.verifyMonitorOwnership(monitorId, userId);

    // Deduplicate across both lists for the ownership check
    const allIds = [...new Set([...channelIds, ...escalationChannelIds])];

    if (allIds.length > 0) {
      const owned = await this.prisma.alertChannel.findMany({
        where: { id: { in: allIds }, userId },
        select: { id: true },
      });

      if (owned.length !== allIds.length) {
        throw new ForbiddenException(
          'One or more channel IDs do not belong to this user or do not exist',
        );
      }
    }

    // Channels that are ONLY in escalation list (not also in normal list)
    const escalationOnly = escalationChannelIds.filter((id) => !channelIds.includes(id));

    await this.prisma.$transaction(async (tx) => {
      // Delete all existing junction rows for this monitor
      await tx.monitorAlertChannel.deleteMany({ where: { monitorId } });

      // Re-create normal channels
      if (channelIds.length > 0) {
        await tx.monitorAlertChannel.createMany({
          data: channelIds.map((alertChannelId) => ({
            monitorId,
            alertChannelId,
            isEscalation: false,
          })),
        });
      }

      // Re-create escalation-only channels
      if (escalationOnly.length > 0) {
        await tx.monitorAlertChannel.createMany({
          data: escalationOnly.map((alertChannelId) => ({
            monitorId,
            alertChannelId,
            isEscalation: true,
          })),
        });
      }
    });

    this.logger.log(
      `Channels updated — monitorId=${monitorId} normal=${channelIds.length} escalation=${escalationChannelIds.length}`,
    );
  }

  // ── Threshold resolution ───────────────────────────────────────────────────

  /**
   * Returns the effective alertThreshold for a monitor.
   *
   * Priority:
   *   1. MonitorAlertSettings.alertThreshold  (per-monitor override)
   *   2. Monitor.alertThreshold               (column-level default)
   *   3. 2                                    (hard-coded fallback)
   */
  async getEffectiveThreshold(monitorId: string): Promise<number> {
    const settings = await this.prisma.monitorAlertSettings.findUnique({
      where: { monitorId },
      select: { alertThreshold: true },
    });

    if (settings) return settings.alertThreshold;

    const monitor = await this.prisma.monitor.findUnique({
      where: { id: monitorId },
      select: { alertThreshold: true },
    });

    return monitor?.alertThreshold ?? 2;
  }

  // ── Suppressed alert log ───────────────────────────────────────────────────

  /**
   * Returns the most recent suppressed alert records for a monitor (newest first).
   */
  async getSuppressedAlerts(monitorId: string, limit = 20) {
    return this.prisma.suppressedAlert.findMany({
      where: { monitorId },
      orderBy: { suppressedAt: 'desc' },
      take: limit,
    });
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async verifyMonitorOwnership(monitorId: string, userId: string): Promise<void> {
    const monitor = await this.prisma.monitor.findUnique({
      where: { id: monitorId },
      select: { userId: true },
    });

    if (!monitor) throw new NotFoundException(`Monitor ${monitorId} not found`);
    if (monitor.userId !== userId) {
      throw new ForbiddenException('Not the owner of this monitor');
    }
  }

  private validateSettingsDto(dto: UpsertAlertSettingsDto): void {
    if (dto.escalationThreshold <= dto.alertThreshold) {
      throw new BadRequestException(
        `escalationThreshold (${dto.escalationThreshold}) must be greater than alertThreshold (${dto.alertThreshold})`,
      );
    }

    if (dto.quietHoursEnabled) {
      if (!dto.quietHoursStart || !dto.quietHoursEnd) {
        throw new BadRequestException(
          'quietHoursStart and quietHoursEnd are required when quietHoursEnabled is true',
        );
      }

      if (!dto.quietHoursDays || dto.quietHoursDays.length === 0) {
        throw new BadRequestException(
          'quietHoursDays must contain at least one day when quietHoursEnabled is true',
        );
      }
    }
  }
}
