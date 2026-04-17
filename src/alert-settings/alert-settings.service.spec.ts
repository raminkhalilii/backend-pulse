import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  AlertChannel,
  AlertChannelType,
  MonitorAlertSettings,
  MonitorFrequency,
  PingStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma';
import { AlertSettingsService } from './alert-settings.service';
import { UpsertAlertSettingsDto } from './dto/upsert-alert-settings.dto';

// ── Test-double factories ─────────────────────────────────────────────────────

function makeChannel(
  overrides: Partial<AlertChannel> & { id: string; userId: string },
): AlertChannel {
  return {
    type: AlertChannelType.EMAIL,
    value: 'test@example.com',
    label: null,
    enabled: true,
    secret: null,
    platformMetadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeSettings(overrides: Partial<MonitorAlertSettings> = {}): MonitorAlertSettings {
  return {
    id: 'settings-1',
    monitorId: 'monitor-1',
    alertThreshold: 2,
    escalationThreshold: 5,
    alertOnRecovery: true,
    quietHoursEnabled: false,
    quietHoursStart: null,
    quietHoursEnd: null,
    quietHoursDays: [0, 1, 2, 3, 4, 5, 6] as unknown as MonitorAlertSettings['quietHoursDays'],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ── Prisma mock ───────────────────────────────────────────────────────────────

function makePrismaMock() {
  const txMock = {
    monitorAlertChannel: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };

  return {
    monitorAlertSettings: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue(makeSettings()),
    },
    monitorAlertChannel: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    alertChannel: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    monitor: {
      findUnique: jest.fn().mockResolvedValue({ userId: 'user-1', alertThreshold: 3 }),
    },
    suppressedAlert: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn(async (cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock)),
    _tx: txMock,
  };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('AlertSettingsService', () => {
  let service: AlertSettingsService;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [AlertSettingsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<AlertSettingsService>(AlertSettingsService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── getChannelsForMonitor ──────────────────────────────────────────────────

  describe('getChannelsForMonitor', () => {
    it('returns only the channels linked to this monitor', async () => {
      const ch1 = makeChannel({ id: 'ch-1', userId: 'user-1' });
      const ch2 = makeChannel({ id: 'ch-2', userId: 'user-1' });

      prisma.monitorAlertChannel.findMany.mockResolvedValue([
        { alertChannel: ch1, isEscalation: false },
        { alertChannel: ch2, isEscalation: false },
      ]);

      const result = await service.getChannelsForMonitor('monitor-1');

      expect(result).toHaveLength(2);
      expect(result.map((c) => c.id)).toEqual(['ch-1', 'ch-2']);
      expect(prisma.monitorAlertChannel.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { monitorId: 'monitor-1' } }),
      );
    });

    it('filters out disabled channels', async () => {
      const enabled = makeChannel({ id: 'ch-enabled', userId: 'user-1', enabled: true });
      const disabled = makeChannel({ id: 'ch-disabled', userId: 'user-1', enabled: false });

      prisma.monitorAlertChannel.findMany.mockResolvedValue([
        { alertChannel: enabled, isEscalation: false },
        { alertChannel: disabled, isEscalation: false },
      ]);

      const result = await service.getChannelsForMonitor('monitor-1');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('ch-enabled');
    });

    it('returns an empty array when no channels are linked', async () => {
      prisma.monitorAlertChannel.findMany.mockResolvedValue([]);
      const result = await service.getChannelsForMonitor('monitor-1');
      expect(result).toHaveLength(0);
    });

    it('passes isEscalation: true filter when escalationOnly=true', async () => {
      const escalation = makeChannel({ id: 'ch-esc', userId: 'user-1' });

      prisma.monitorAlertChannel.findMany.mockResolvedValue([
        { alertChannel: escalation, isEscalation: true },
      ]);

      const result = await service.getChannelsForMonitor('monitor-1', true);

      expect(result).toHaveLength(1);
      expect(prisma.monitorAlertChannel.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { monitorId: 'monitor-1', isEscalation: true },
        }),
      );
    });

    it('does not pass isEscalation filter when escalationOnly=false (default)', async () => {
      prisma.monitorAlertChannel.findMany.mockResolvedValue([]);
      await service.getChannelsForMonitor('monitor-1');

      expect(prisma.monitorAlertChannel.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { monitorId: 'monitor-1' }, // no isEscalation key
        }),
      );
    });
  });

  // ── setChannelsForMonitor ──────────────────────────────────────────────────

  describe('setChannelsForMonitor', () => {
    it('atomically deletes and re-creates channel links', async () => {
      prisma.monitor.findUnique.mockResolvedValue({ userId: 'user-1' });
      prisma.alertChannel.findMany.mockResolvedValue([
        { id: 'ch-1' },
        { id: 'ch-2' },
        { id: 'ch-3' },
      ]);

      await service.setChannelsForMonitor('monitor-1', 'user-1', ['ch-1', 'ch-2'], ['ch-3']);

      expect(prisma._tx.monitorAlertChannel.deleteMany).toHaveBeenCalledWith({
        where: { monitorId: 'monitor-1' },
      });
      expect(prisma._tx.monitorAlertChannel.createMany).toHaveBeenCalledTimes(2);
    });

    it('only creates escalation rows for channels NOT already in the normal list', async () => {
      prisma.monitor.findUnique.mockResolvedValue({ userId: 'user-1' });
      prisma.alertChannel.findMany.mockResolvedValue([{ id: 'ch-1' }, { id: 'ch-2' }]);

      await service.setChannelsForMonitor('monitor-1', 'user-1', ['ch-1'], ['ch-1', 'ch-2']);

      // Normal list: ['ch-1']  — escalation-only list: ['ch-2'] (ch-1 excluded because it's in normal)
      const calls = prisma._tx.monitorAlertChannel.createMany.mock.calls as Array<
        [{ data: Array<{ alertChannelId: string; isEscalation: boolean }> }]
      >;

      const escalationCall = calls.find((c) => c[0].data.some((d) => d.isEscalation));
      expect(escalationCall).toBeDefined();
      expect(escalationCall![0].data).toEqual([
        { monitorId: 'monitor-1', alertChannelId: 'ch-2', isEscalation: true },
      ]);
    });

    it('throws ForbiddenException when channelIds do not belong to the user', async () => {
      prisma.monitor.findUnique.mockResolvedValue({ userId: 'user-1' });
      // Only returns 1 channel but we asked for 2 → ownership check fails
      prisma.alertChannel.findMany.mockResolvedValue([{ id: 'ch-1' }]);

      await expect(
        service.setChannelsForMonitor('monitor-1', 'user-1', ['ch-1', 'ch-stolen'], []),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when the monitor does not exist', async () => {
      prisma.monitor.findUnique.mockResolvedValue(null);

      await expect(
        service.setChannelsForMonitor('monitor-missing', 'user-1', [], []),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when the monitor belongs to a different user', async () => {
      prisma.monitor.findUnique.mockResolvedValue({ userId: 'user-2' });

      await expect(service.setChannelsForMonitor('monitor-1', 'user-1', [], [])).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('succeeds with empty channelIds (clears all channels)', async () => {
      prisma.monitor.findUnique.mockResolvedValue({ userId: 'user-1' });
      prisma.alertChannel.findMany.mockResolvedValue([]);

      await expect(
        service.setChannelsForMonitor('monitor-1', 'user-1', [], []),
      ).resolves.not.toThrow();

      expect(prisma._tx.monitorAlertChannel.deleteMany).toHaveBeenCalled();
      // createMany should NOT be called for empty lists
      expect(prisma._tx.monitorAlertChannel.createMany).not.toHaveBeenCalled();
    });
  });

  // ── getEffectiveThreshold ─────────────────────────────────────────────────

  describe('getEffectiveThreshold', () => {
    it('returns MonitorAlertSettings.alertThreshold when a settings record exists', async () => {
      prisma.monitorAlertSettings.findUnique.mockResolvedValue({ alertThreshold: 4 });

      const result = await service.getEffectiveThreshold('monitor-1');

      expect(result).toBe(4);
      // Should NOT fall through to Monitor lookup
      expect(prisma.monitor.findUnique).not.toHaveBeenCalled();
    });

    it('falls back to Monitor.alertThreshold when no settings record exists', async () => {
      prisma.monitorAlertSettings.findUnique.mockResolvedValue(null);
      prisma.monitor.findUnique.mockResolvedValue({ alertThreshold: 3 });

      const result = await service.getEffectiveThreshold('monitor-1');

      expect(result).toBe(3);
    });

    it('falls back to 2 when neither settings nor monitor row exist', async () => {
      prisma.monitorAlertSettings.findUnique.mockResolvedValue(null);
      prisma.monitor.findUnique.mockResolvedValue(null);

      const result = await service.getEffectiveThreshold('monitor-1');

      expect(result).toBe(2);
    });
  });

  // ── upsertSettingsForMonitor validation ───────────────────────────────────

  describe('upsertSettingsForMonitor — cross-field validation', () => {
    function makeDto(overrides: Partial<UpsertAlertSettingsDto> = {}): UpsertAlertSettingsDto {
      return {
        alertThreshold: 2,
        escalationThreshold: 5,
        alertOnRecovery: true,
        quietHoursEnabled: false,
        quietHoursDays: [0, 1, 2, 3, 4, 5, 6],
        ...overrides,
      };
    }

    beforeEach(() => {
      prisma.monitor.findUnique.mockResolvedValue({ userId: 'user-1' });
    });

    it('throws BadRequestException when escalationThreshold <= alertThreshold', async () => {
      const dto = makeDto({ alertThreshold: 5, escalationThreshold: 3 });
      await expect(service.upsertSettingsForMonitor('monitor-1', 'user-1', dto)).rejects.toThrow(
        'escalationThreshold',
      );
    });

    it('throws BadRequestException when quietHoursEnabled but quietHoursStart missing', async () => {
      const dto = makeDto({ quietHoursEnabled: true, quietHoursEnd: '08:00' });
      await expect(service.upsertSettingsForMonitor('monitor-1', 'user-1', dto)).rejects.toThrow(
        'quietHoursStart',
      );
    });

    it('throws BadRequestException when quietHoursEnabled but quietHoursDays is empty', async () => {
      const dto = makeDto({
        quietHoursEnabled: true,
        quietHoursStart: '22:00',
        quietHoursEnd: '08:00',
        quietHoursDays: [],
      });
      await expect(service.upsertSettingsForMonitor('monitor-1', 'user-1', dto)).rejects.toThrow(
        'quietHoursDays',
      );
    });

    it('calls prisma.upsert with correct data on valid input', async () => {
      const dto = makeDto({
        quietHoursEnabled: true,
        quietHoursStart: '22:00',
        quietHoursEnd: '08:00',
        quietHoursDays: [1, 2, 3],
      });

      await service.upsertSettingsForMonitor('monitor-1', 'user-1', dto);

      expect(prisma.monitorAlertSettings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { monitorId: 'monitor-1' },
          create: expect.objectContaining({ monitorId: 'monitor-1', alertThreshold: 2 }),
        }),
      );
    });
  });

  // ── Monitor missing/ownership checks are shared; spot-check via upsert ────

  it('throws NotFoundException when monitor is not found in upsert', async () => {
    prisma.monitor.findUnique.mockResolvedValue(null);
    await expect(
      service.upsertSettingsForMonitor('bad-id', 'user-1', {
        alertThreshold: 2,
        escalationThreshold: 5,
        alertOnRecovery: true,
        quietHoursEnabled: false,
        quietHoursDays: [0],
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws ForbiddenException when upsert caller does not own the monitor', async () => {
    prisma.monitor.findUnique.mockResolvedValue({ userId: 'user-2' });
    await expect(
      service.upsertSettingsForMonitor('monitor-1', 'user-1', {
        alertThreshold: 2,
        escalationThreshold: 5,
        alertOnRecovery: true,
        quietHoursEnabled: false,
        quietHoursDays: [0],
      }),
    ).rejects.toThrow(ForbiddenException);
  });
});
