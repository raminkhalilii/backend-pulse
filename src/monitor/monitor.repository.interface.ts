import { UpdateMonitorDto } from '../auth/dto/update-monitor-dto';
import { CreateMonitorDto } from '../auth/dto/create-monitor-dto';
import { Monitor, MonitorFrequency, PingStatus } from '../../generated/prisma/client';

export interface HeartbeatSnapshot {
  status: PingStatus;
  latencyMs: number | null;
  timestamp: Date;
}

export type MonitorWithHeartbeats = Monitor & { heartbeats: HeartbeatSnapshot[] };

export interface IMonitorRepository {
  findById(id: string): Promise<Monitor | null>;
  findAllByUserId(userId: string): Promise<Monitor[]>;
  findAllByUserIdWithHeartbeats(userId: string): Promise<MonitorWithHeartbeats[]>;
  findActiveByFrequencies(frequencies: MonitorFrequency[]): Promise<Monitor[]>;
  create(userId: string, data: CreateMonitorDto): Promise<Monitor>;
  delete(id: string, userId: string): Promise<boolean>;
  update(id: string, userId: string, data: UpdateMonitorDto): Promise<Monitor | null>;
}

export const MONITOR_REPOSITORY_TOKEN = 'MONITOR_REPOSITORY_TOKEN';
