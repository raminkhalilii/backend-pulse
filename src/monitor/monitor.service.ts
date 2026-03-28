import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { type IMonitorRepository, MONITOR_REPOSITORY_TOKEN } from './monitor.repository.interface';
import * as dns from 'node:dns/promises';
import { Monitor, MonitorFrequency } from '../../generated/prisma/client';
import { UpdateMonitorDto } from '../auth/dto/update-monitor-dto';
import { CreateMonitorDto } from '../auth/dto/create-monitor-dto';

@Injectable()
export class MonitorService {
  constructor(
    @Inject(MONITOR_REPOSITORY_TOKEN) private readonly monitorRepository: IMonitorRepository,
  ) {}
  private isPrivateIP(ip: string): boolean {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4) return false;

    return (
      parts[0] === 10 || // 10.0.0.0 to 10.255.255.255
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || // 172.16.0.0 to 172.31.255.255
      (parts[0] === 192 && parts[1] === 168) || // 192.168.0.0 to 192.168.255.255
      parts[0] === 127 || // Localhost
      parts[0] === 0 || // Current network
      (parts[0] === 169 && parts[1] === 254) // Link-local
    );
  }

  private async validateUrlSecurity(urlString: string): Promise<void> {
    try {
      const urlObj = new URL(urlString);
      const lookupResult = await dns.lookup(urlObj.hostname);

      if (this.isPrivateIP(lookupResult.address)) {
        throw new BadRequestException(
          'Security exception: Cannot monitor internal or private IP addresses.',
        );
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('Invalid URL or DNS resolution failed.');
    }
  }

  async findAll(userId: string): Promise<Monitor[]> {
    return this.monitorRepository.findAllByUserId(userId);
  }

  async create(userId: string, createMonitorDto: CreateMonitorDto): Promise<Monitor> {
    // 1. Run the security check. If it fails, it throws an error and execution stops here.
    await this.validateUrlSecurity(createMonitorDto.url);

    // 2. If we reach this line, the URL is safe. Save it to the database.
    return this.monitorRepository.create(userId, createMonitorDto);
  }

  async update(
    id: string,
    userId: string,
    updateMonitorDto: UpdateMonitorDto,
  ): Promise<Monitor | null> {
    // 1. Only run the DNS check if the user is actually trying to change the URL
    if (updateMonitorDto.url) {
      await this.validateUrlSecurity(updateMonitorDto.url);
    }

    // 2. Pass the safe data to the database
    return this.monitorRepository.update(id, userId, updateMonitorDto);
  }

  async findDueMonitors(frequencies: MonitorFrequency[]): Promise<Monitor[]> {
    return this.monitorRepository.findActiveByFrequencies(frequencies);
  }
}
