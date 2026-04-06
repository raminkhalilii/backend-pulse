import { PrismaService } from '../../prisma/prisma';
import { IMonitorRepository, MonitorWithHeartbeats } from '../monitor/monitor.repository.interface';
import { Injectable } from '@nestjs/common';
import { Monitor, MonitorFrequency } from '../../generated/prisma/client';
import { UpdateMonitorDto } from 'src/auth/dto/update-monitor-dto';
import { CreateMonitorDto } from '../auth/dto/create-monitor-dto';

@Injectable()
export class MonitorRepository implements IMonitorRepository {
  constructor(private readonly prisma: PrismaService) {}
  async create(userId: string, data: CreateMonitorDto): Promise<Monitor> {
    return this.prisma.monitor.create({
      data: {
        userId,
        name: data.name,
        url: data.url,
        frequency: data.frequency,
      },
    });
  }

  async findAllByUserId(userId: string): Promise<Monitor[]> {
    return this.prisma.monitor.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAllByUserIdWithHeartbeats(userId: string): Promise<MonitorWithHeartbeats[]> {
    return this.prisma.monitor.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        heartbeats: {
          select: { status: true, latencyMs: true, timestamp: true },
          orderBy: { timestamp: 'desc' },
          take: 10,
        },
      },
    });
  }

  async findById(id: string): Promise<Monitor | null> {
    return this.prisma.monitor.findUnique({
      where: { id },
    });
  }

  async findActiveByFrequencies(frequencies: MonitorFrequency[]): Promise<Monitor[]> {
    return this.prisma.monitor.findMany({
      where: {
        isActive: true,
        frequency: { in: frequencies },
      },
    });
  }
  async update(id: string, userId: string, data: UpdateMonitorDto): Promise<Monitor | null> {
    // 1. Use updateMany to safely enforce the userId check
    const result = await this.prisma.monitor.updateMany({
      where: {
        id: id,
        userId: userId,
      },
      data: {
        name: data.name,
        url: data.url,
        frequency: data.frequency,
        isActive: data.isActive,
      },
    });

    // 2. If the count is 0, the monitor either doesn't exist or belongs to someone else
    if (result.count === 0) {
      return null;
    }

    // 3. updateMany doesn't return the updated record, so we fetch it to return to the user
    return this.prisma.monitor.findUnique({
      where: { id },
    });
  }

  async delete(id: string, userId: string): Promise<boolean> {
    // Similar to update, we use deleteMany for security
    const result = await this.prisma.monitor.deleteMany({
      where: {
        id: id,
        userId: userId,
      },
    });

    return result.count > 0;
  }
}
