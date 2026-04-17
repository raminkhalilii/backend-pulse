import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AlertChannel, AlertChannelType, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma';
import { DiscordService } from './discord.service';
import { CreateAlertChannelDto } from './dto/create-alert-channel.dto';
import { UpdateAlertChannelDto } from './dto/update-alert-channel.dto';
import { EmailService } from './email.service';
import { SSRFProtectionError } from './errors/webhook.errors';
import { SlackService } from './slack.service';
import { WebhookService, WebhookTestResult } from './webhook.service';

/**
 * Free-plan limit on total alert channels per user (across all types).
 *
 * TODO: Replace this constant with a plan-aware lookup once subscription
 * tiers are implemented. Per-plan limits should be fetched from the User's
 * plan record and passed in here. For now every user is on the free plan.
 */
const FREE_PLAN_CHANNEL_LIMIT = 10;

/**
 * Public representation of an AlertChannel returned by the API.
 * The `secret` field is never returned — only a boolean flag indicating
 * whether one is configured so the frontend can show the "Signed" badge
 * and manage the secret UI state without ever seeing the raw value.
 */
export type PublicAlertChannel = Omit<AlertChannel, 'secret'> & {
  hasSecret: boolean;
};

/** Result shape returned by the Slack and Discord test endpoints. */
export interface PlatformTestResult {
  success: boolean;
  error?: string;
}

@Injectable()
export class AlertChannelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly webhookService: WebhookService,
    private readonly slackService: SlackService,
    private readonly discordService: DiscordService,
  ) {}

  async create(userId: string, dto: CreateAlertChannelDto): Promise<PublicAlertChannel> {
    // ── Free-plan guard ───────────────────────────────────────────────────────
    // TODO: Swap FREE_PLAN_CHANNEL_LIMIT for a per-plan value once billing is added.
    const existingCount = await this.prisma.alertChannel.count({ where: { userId } });
    if (existingCount >= FREE_PLAN_CHANNEL_LIMIT) {
      throw new ForbiddenException(
        `You have reached the maximum of ${FREE_PLAN_CHANNEL_LIMIT} alert channels ` +
          `allowed on the free plan.`,
      );
    }

    const channel = await this.prisma.alertChannel.create({
      data: {
        userId,
        type: dto.type,
        value: dto.value,
        label: dto.label ?? null,
        secret: dto.secret ?? null,
        // Only include platformMetadata when the caller provides it — omitting
        // the key lets Prisma default the nullable column to NULL in the DB.
        // Cast to Prisma.InputJsonValue for type compatibility.
        ...(dto.platformMetadata != null && {
          platformMetadata: dto.platformMetadata as Prisma.InputJsonValue,
        }),
      },
    });

    return this.toPublic(channel);
  }

  async findAll(userId: string): Promise<PublicAlertChannel[]> {
    const channels = await this.prisma.alertChannel.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    return channels.map((c) => this.toPublic(c));
  }

  async update(
    id: string,
    userId: string,
    dto: UpdateAlertChannelDto,
  ): Promise<PublicAlertChannel> {
    const channel = await this.prisma.alertChannel.findUnique({ where: { id } });
    if (!channel) throw new NotFoundException('Alert channel not found');
    if (channel.userId !== userId) throw new ForbiddenException('Access denied');

    const updated = await this.prisma.alertChannel.update({
      where: { id },
      data: {
        ...(dto.enabled !== undefined && { enabled: dto.enabled }),
        ...(dto.label !== undefined && { label: dto.label }),
        // Allow setting, updating, or clearing (null) the secret
        ...(dto.secret !== undefined && { secret: dto.secret || null }),
        // Allow updating or clearing (null) platformMetadata.
        // Passing null explicitly sets the column to SQL NULL.
        // Cast to Prisma.InputJsonValue for type compatibility.
        ...(dto.platformMetadata !== undefined && {
          platformMetadata: dto.platformMetadata as Prisma.InputJsonValue,
        }),
      },
    });

    return this.toPublic(updated);
  }

  async remove(id: string, userId: string): Promise<void> {
    const channel = await this.prisma.alertChannel.findUnique({ where: { id } });
    if (!channel) throw new NotFoundException('Alert channel not found');
    if (channel.userId !== userId) throw new ForbiddenException('Access denied');

    await this.prisma.alertChannel.delete({ where: { id } });
  }

  /**
   * Send a real test alert email to verify an EMAIL channel is working.
   * Uses DOWN type so the recipient sees the full red template.
   * Does NOT create an AlertEvent record.
   */
  async sendTest(id: string, userId: string): Promise<void> {
    const channel = await this.prisma.alertChannel.findUnique({ where: { id } });
    if (!channel) throw new NotFoundException('Alert channel not found');
    if (channel.userId !== userId) throw new ForbiddenException('Access denied');

    const appUrl = process.env.APP_URL ?? 'https://pulsee.website';

    await this.emailService.sendAlertEmail({
      to: channel.value,
      monitorName: 'Example Monitor (test)',
      monitorUrl: 'https://example.com',
      type: 'DOWN',
      triggeredAt: new Date(),
      errorMessage: 'This is a test alert — your channel is configured correctly.',
      dashboardUrl: `${appUrl}/dashboard`,
    });
  }

  /**
   * Fire a synthetic test payload to a WEBHOOK channel to verify the
   * endpoint is reachable and configured correctly.
   *
   * Applies full SSRF protection. Returns a structured result rather than
   * throwing delivery errors (SSRF config errors are still thrown as 400).
   * Does NOT create AlertEvent or WebhookDeliveryLog records.
   */
  async testWebhookChannel(id: string, userId: string): Promise<WebhookTestResult> {
    const channel = await this.prisma.alertChannel.findUnique({ where: { id } });
    if (!channel) throw new NotFoundException('Alert channel not found');
    if (channel.userId !== userId) throw new ForbiddenException('Access denied');
    if (channel.type !== AlertChannelType.WEBHOOK) {
      throw new BadRequestException('This endpoint is only available for WEBHOOK channels');
    }

    try {
      return await this.webhookService.sendTestWebhook(channel.value, channel.secret ?? undefined);
    } catch (error) {
      if (error instanceof SSRFProtectionError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  /**
   * Fire a test Slack Block Kit message to a SLACK channel to verify
   * the webhook URL is reachable and correctly configured.
   * Does NOT create AlertEvent or WebhookDeliveryLog records.
   */
  async testSlackChannel(id: string, userId: string): Promise<PlatformTestResult> {
    const channel = await this.prisma.alertChannel.findUnique({ where: { id } });
    if (!channel) throw new NotFoundException('Alert channel not found');
    if (channel.userId !== userId) throw new ForbiddenException('Access denied');
    if (channel.type !== AlertChannelType.SLACK) {
      throw new BadRequestException('This endpoint is only available for SLACK channels');
    }

    const appUrl = process.env.APP_URL ?? 'https://pulsee.website';

    try {
      await this.slackService.sendSlackAlert({
        webhookUrl: channel.value,
        monitorName: 'Test Monitor',
        monitorUrl: 'https://example.com',
        type: 'DOWN',
        triggeredAt: new Date(),
        errorMessage: 'This is a test alert — your channel is configured correctly.',
        dashboardUrl: `${appUrl}/dashboard`,
      });
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  }

  /**
   * Fire a test Discord Embed message to a DISCORD channel to verify
   * the webhook URL is reachable and correctly configured.
   * Does NOT create AlertEvent or WebhookDeliveryLog records.
   */
  async testDiscordChannel(id: string, userId: string): Promise<PlatformTestResult> {
    const channel = await this.prisma.alertChannel.findUnique({ where: { id } });
    if (!channel) throw new NotFoundException('Alert channel not found');
    if (channel.userId !== userId) throw new ForbiddenException('Access denied');
    if (channel.type !== AlertChannelType.DISCORD) {
      throw new BadRequestException('This endpoint is only available for DISCORD channels');
    }

    const appUrl = process.env.APP_URL ?? 'https://pulsee.website';

    try {
      await this.discordService.sendDiscordAlert({
        webhookUrl: channel.value,
        monitorName: 'Test Monitor',
        monitorUrl: 'https://example.com',
        type: 'DOWN',
        triggeredAt: new Date(),
        errorMessage: 'This is a test alert — your channel is configured correctly.',
        dashboardUrl: `${appUrl}/dashboard`,
      });
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  }

  /**
   * Returns the most recent WebhookDeliveryLog records for the given channel,
   * ordered newest-first. Used by the frontend to display delivery history.
   */
  async getWebhookLogs(id: string, userId: string, limit: number, offset: number) {
    const channel = await this.prisma.alertChannel.findUnique({ where: { id } });
    if (!channel) throw new NotFoundException('Alert channel not found');
    if (channel.userId !== userId) throw new ForbiddenException('Access denied');

    return this.prisma.webhookDeliveryLog.findMany({
      where: { alertChannelId: id },
      orderBy: { attemptedAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  /**
   * Converts a full Prisma AlertChannel (which includes the raw `secret`)
   * to a public-safe representation. The secret is never sent to clients —
   * only a `hasSecret` boolean indicating whether one is configured.
   */
  private toPublic(channel: AlertChannel): PublicAlertChannel {
    const { secret, ...rest } = channel;
    return { ...rest, hasSecret: secret !== null };
  }
}
