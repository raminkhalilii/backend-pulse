import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AlertChannel } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma';
import { CreateAlertChannelDto } from './dto/create-alert-channel.dto';
import { UpdateAlertChannelDto } from './dto/update-alert-channel.dto';
import { EmailService } from './email.service';

/**
 * Free-plan limit on total alert channels per user (across all types).
 *
 * TODO: Replace this constant with a plan-aware lookup once subscription
 * tiers are implemented. Per-plan limits should be fetched from the User's
 * plan record and passed in here. For now every user is on the free plan.
 */
const FREE_PLAN_CHANNEL_LIMIT = 10;

@Injectable()
export class AlertChannelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  async create(userId: string, dto: CreateAlertChannelDto): Promise<AlertChannel> {
    // ── Free-plan guard ───────────────────────────────────────────────────────
    // TODO: Swap FREE_PLAN_CHANNEL_LIMIT for a per-plan value once billing is added.
    const existingCount = await this.prisma.alertChannel.count({ where: { userId } });
    if (existingCount >= FREE_PLAN_CHANNEL_LIMIT) {
      throw new ForbiddenException(
        `You have reached the maximum of ${FREE_PLAN_CHANNEL_LIMIT} alert channels ` +
          `allowed on the free plan.`,
      );
    }

    return this.prisma.alertChannel.create({
      data: {
        userId,
        type: dto.type,
        value: dto.value,
        label: dto.label ?? null,
      },
    });
  }

  async findAll(userId: string): Promise<AlertChannel[]> {
    return this.prisma.alertChannel.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async update(id: string, userId: string, dto: UpdateAlertChannelDto): Promise<AlertChannel> {
    const channel = await this.prisma.alertChannel.findUnique({ where: { id } });
    if (!channel) throw new NotFoundException('Alert channel not found');
    if (channel.userId !== userId) throw new ForbiddenException('Access denied');

    return this.prisma.alertChannel.update({
      where: { id },
      data: {
        ...(dto.enabled !== undefined && { enabled: dto.enabled }),
        ...(dto.label !== undefined && { label: dto.label }),
      },
    });
  }

  async remove(id: string, userId: string): Promise<void> {
    const channel = await this.prisma.alertChannel.findUnique({ where: { id } });
    if (!channel) throw new NotFoundException('Alert channel not found');
    if (channel.userId !== userId) throw new ForbiddenException('Access denied');

    await this.prisma.alertChannel.delete({ where: { id } });
  }

  /**
   * Send a real test alert email to verify the channel is working.
   * Uses DOWN type so the recipient sees the full red template.
   * Does NOT create an AlertEvent record — this is a one-off delivery check.
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
}
