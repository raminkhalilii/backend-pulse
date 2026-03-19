import { UpdateMonitorDto } from '../auth/dto/update-monitor-dto';
import { CreateMonitorDto } from '../auth/dto/create-monitor-dto';
import { Monitor } from '../../generated/prisma/client';

export interface IMonitorRepository {
  findById(id: string): Promise<Monitor | null>;
  findAllByUserId(userId: string): Promise<Monitor[]>;
  create(userId: string, data: CreateMonitorDto): Promise<Monitor>;
  delete(id: string, userId: string): Promise<boolean>;
  update(id: string, userId: string, data: UpdateMonitorDto): Promise<Monitor | null>;
}

export const MONITOR_REPOSITORY_TOKEN = 'MONITOR_REPOSITORY_TOKEN';
