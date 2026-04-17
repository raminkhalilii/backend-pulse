import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import {
  AlertEventType,
  Heartbeat,
  Monitor,
  MonitorAlertSettings,
  MonitorFrequency,
  PingStatus,
} from '../../generated/prisma/client';
import { AlertSettingsService } from '../alert-settings/alert-settings.service';
import { QuietHoursService } from '../alert-settings/quiet-hours.service';
import { PrismaService } from '../../prisma/prisma';
import { ALERT_DELIVERY_QUEUE } from '../queue/queue.constants';
import { AlertDeliveryPayload, AlertEngineService } from './alert-engine.service';

// ── Test-double factories ────────────────────────────────────────────────────

function makeMonitor(overrides: Partial<Monitor> = {}): Monitor {
  return {
    id: 'monitor-1',
    userId: 'user-1',
    name: 'Test Monitor',
    url: 'https://example.com',
    frequency: MonitorFrequency.ONE_MIN,
    isActive: true,
    consecutiveFailures: 0,
    alertThreshold: 2,
    lastStatus: null,
    lastAlertedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeHeartbeat(status: PingStatus, monitorId = 'monitor-1'): Heartbeat {
  return {
    id: BigInt(1),
    monitorId,
    status,
    latencyMs: status === PingStatus.UP ? 120 : null,
    timestamp: new Date(),
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
    alertEvent: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'evt-1', type: AlertEventType.DOWN }),
    },
    monitor: {
      update: jest.fn().mockResolvedValue({}),
    },
  };

  return {
    $transaction: jest.fn(async (cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock)),
    monitor: { update: jest.fn().mockResolvedValue({}) },
    suppressedAlert: { create: jest.fn().mockResolvedValue({}) },
    _tx: txMock,
  };
}

function makeAlertSettingsMock() {
  return {
    getSettingsForMonitor: jest.fn().mockResolvedValue(null),
    getChannelsForMonitor: jest.fn().mockResolvedValue([]),
  };
}

function makeQuietHoursMock() {
  return {
    isInQuietHours: jest.fn().mockReturnValue(false),
    getNextAlertTime: jest.fn().mockReturnValue(new Date()),
  };
}

function makeQueueMock() {
  return { add: jest.fn().mockResolvedValue({}) };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('AlertEngineService', () => {
  let service: AlertEngineService;
  let prisma: ReturnType<typeof makePrismaMock>;
  let alertSettings: ReturnType<typeof makeAlertSettingsMock>;
  let quietHours: ReturnType<typeof makeQuietHoursMock>;
  let queue: ReturnType<typeof makeQueueMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();
    alertSettings = makeAlertSettingsMock();
    quietHours = makeQuietHoursMock();
    queue = makeQueueMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlertEngineService,
        { provide: PrismaService, useValue: prisma },
        { provide: AlertSettingsService, useValue: alertSettings },
        { provide: QuietHoursService, useValue: quietHours },
        { provide: getQueueToken(ALERT_DELIVERY_QUEUE), useValue: queue },
      ],
    }).compile();

    service = module.get<AlertEngineService>(AlertEngineService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── 1. DOWN alert fires when threshold is reached ─────────────────────────

  it('fires a DOWN alert when consecutiveFailures reaches alertThreshold', async () => {
    const monitor = makeMonitor({
      consecutiveFailures: 1,
      lastStatus: PingStatus.DOWN,
      alertThreshold: 2,
    });
    const heartbeat = makeHeartbeat(PingStatus.DOWN);
    const createdEvent: AlertDeliveryPayload = {
      alertEventId: 'evt-down',
      monitorId: 'monitor-1',
      type: AlertEventType.DOWN,
    };

    prisma._tx.alertEvent.findFirst.mockResolvedValue(null);
    prisma._tx.alertEvent.create.mockResolvedValue({ id: createdEvent.alertEventId });

    await service.processHeartbeat(heartbeat, monitor);

    expect(prisma._tx.alertEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: AlertEventType.DOWN, monitorId: 'monitor-1' }),
      }),
    );
    expect(queue.add).toHaveBeenCalledWith(
      'deliver-alert',
      expect.objectContaining({ alertEventId: 'evt-down', type: AlertEventType.DOWN }),
    );
  });

  // ── 2. DOWN alert does NOT fire before threshold ───────────────────────────

  it('does not fire a DOWN alert when consecutiveFailures < alertThreshold', async () => {
    const monitor = makeMonitor({
      consecutiveFailures: 0,
      lastStatus: PingStatus.UP,
      alertThreshold: 2,
    });

    await service.processHeartbeat(makeHeartbeat(PingStatus.DOWN), monitor);

    expect(prisma._tx.alertEvent.create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
    expect(prisma._tx.monitor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ consecutiveFailures: 1, lastStatus: PingStatus.DOWN }),
      }),
    );
  });

  // ── 3. DOWN alert does NOT fire twice for the same outage ─────────────────

  it('does not fire a second DOWN alert when an open outage already exists', async () => {
    const monitor = makeMonitor({
      consecutiveFailures: 2,
      lastStatus: PingStatus.DOWN,
      alertThreshold: 2,
    });

    prisma._tx.alertEvent.findFirst.mockResolvedValue({
      id: 'evt-existing',
      type: AlertEventType.DOWN,
    });

    await service.processHeartbeat(makeHeartbeat(PingStatus.DOWN), monitor);

    expect(prisma._tx.alertEvent.create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  // ── 4. RECOVERY alert fires when monitor comes back UP ────────────────────

  it('fires a RECOVERY alert when status flips from DOWN to UP', async () => {
    const monitor = makeMonitor({
      consecutiveFailures: 3,
      lastStatus: PingStatus.DOWN,
      alertThreshold: 2,
    });

    prisma._tx.alertEvent.create.mockResolvedValue({ id: 'evt-recovery' });

    await service.processHeartbeat(makeHeartbeat(PingStatus.UP), monitor);

    expect(prisma._tx.alertEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: AlertEventType.RECOVERY }),
      }),
    );
    expect(queue.add).toHaveBeenCalledWith(
      'deliver-alert',
      expect.objectContaining({ type: AlertEventType.RECOVERY }),
    );
  });

  // ── 5. RECOVERY does NOT fire when monitor was already UP ─────────────────

  it('does not fire a RECOVERY alert when lastStatus is already UP', async () => {
    const monitor = makeMonitor({ consecutiveFailures: 0, lastStatus: PingStatus.UP });

    await service.processHeartbeat(makeHeartbeat(PingStatus.UP), monitor);

    expect(prisma._tx.alertEvent.create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  // ── 6. consecutiveFailures resets to 0 on recovery ───────────────────────

  it('resets consecutiveFailures to 0 when heartbeat is UP', async () => {
    const monitor = makeMonitor({ consecutiveFailures: 5, lastStatus: PingStatus.DOWN });
    prisma._tx.alertEvent.create.mockResolvedValue({ id: 'evt-r' });

    await service.processHeartbeat(makeHeartbeat(PingStatus.UP), monitor);

    expect(prisma._tx.monitor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ consecutiveFailures: 0 }),
      }),
    );
  });

  // ── 7. Queue failure leaves AlertEvent PENDING and does NOT throw ──────────

  it('does not throw when alertQueue.add rejects', async () => {
    const monitor = makeMonitor({ consecutiveFailures: 1, lastStatus: PingStatus.DOWN });

    prisma._tx.alertEvent.findFirst.mockResolvedValue(null);
    prisma._tx.alertEvent.create.mockResolvedValue({ id: 'evt-1' });
    queue.add.mockRejectedValue(new Error('Redis connection refused'));

    await expect(
      service.processHeartbeat(makeHeartbeat(PingStatus.DOWN), monitor),
    ).resolves.not.toThrow();

    expect(prisma._tx.alertEvent.create).toHaveBeenCalled();
  });

  // ── 8. Quiet hours: DOWN alert is suppressed ──────────────────────────────

  it('suppresses a DOWN alert when quiet hours are active', async () => {
    const settings = makeSettings({
      quietHoursEnabled: true,
      quietHoursStart: '22:00',
      quietHoursEnd: '08:00',
    });
    alertSettings.getSettingsForMonitor.mockResolvedValue(settings);
    quietHours.isInQuietHours.mockReturnValue(true);

    const monitor = makeMonitor({ consecutiveFailures: 1, lastStatus: PingStatus.DOWN });

    await service.processHeartbeat(makeHeartbeat(PingStatus.DOWN), monitor);

    // No AlertEvent created, no job enqueued
    expect(prisma._tx.alertEvent.create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();

    // consecutiveFailures IS still updated (outside transaction)
    expect(prisma.monitor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ consecutiveFailures: 2 }),
      }),
    );

    // SuppressedAlert audit row IS created
    expect(prisma.suppressedAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          monitorId: 'monitor-1',
          type: AlertEventType.DOWN,
          reason: 'quiet_hours',
        }),
      }),
    );
  });

  // ── 9. Quiet hours: RECOVERY alert is suppressed ─────────────────────────

  it('suppresses a RECOVERY alert when quiet hours are active', async () => {
    const settings = makeSettings({
      quietHoursEnabled: true,
      quietHoursStart: '22:00',
      quietHoursEnd: '08:00',
    });
    alertSettings.getSettingsForMonitor.mockResolvedValue(settings);
    quietHours.isInQuietHours.mockReturnValue(true);

    const monitor = makeMonitor({ consecutiveFailures: 3, lastStatus: PingStatus.DOWN });

    await service.processHeartbeat(makeHeartbeat(PingStatus.UP), monitor);

    expect(prisma._tx.alertEvent.create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
    expect(prisma.suppressedAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: AlertEventType.RECOVERY }),
      }),
    );
  });

  // ── 10. DOWN alert fires outside quiet hours ──────────────────────────────

  it('fires a DOWN alert when quiet hours are configured but not currently active', async () => {
    const settings = makeSettings({ quietHoursEnabled: true });
    alertSettings.getSettingsForMonitor.mockResolvedValue(settings);
    quietHours.isInQuietHours.mockReturnValue(false); // outside quiet window

    const monitor = makeMonitor({ consecutiveFailures: 1, lastStatus: PingStatus.DOWN });

    prisma._tx.alertEvent.findFirst.mockResolvedValue(null);
    prisma._tx.alertEvent.create.mockResolvedValue({ id: 'evt-1' });

    await service.processHeartbeat(makeHeartbeat(PingStatus.DOWN), monitor);

    expect(prisma._tx.alertEvent.create).toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalled();
  });

  // ── 11. RECOVERY gate: alertOnRecovery=false skips the AlertEvent ─────────

  it('does not create a RECOVERY AlertEvent when alertOnRecovery is false', async () => {
    const settings = makeSettings({ alertOnRecovery: false });
    alertSettings.getSettingsForMonitor.mockResolvedValue(settings);

    const monitor = makeMonitor({ consecutiveFailures: 3, lastStatus: PingStatus.DOWN });

    await service.processHeartbeat(makeHeartbeat(PingStatus.UP), monitor);

    expect(prisma._tx.alertEvent.create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
    // consecutiveFailures is still reset
    expect(prisma._tx.monitor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ consecutiveFailures: 0 }),
      }),
    );
  });

  // ── 12. Escalation fires when thresholds met and channels configured ───────

  it('enqueues an escalation job when consecutiveFailures >= escalationThreshold', async () => {
    const settings = makeSettings({ alertThreshold: 2, escalationThreshold: 2 });
    alertSettings.getSettingsForMonitor.mockResolvedValue(settings);
    // Escalation channels are configured
    alertSettings.getChannelsForMonitor.mockResolvedValue([{ id: 'ch-escalation' }]);

    const monitor = makeMonitor({ consecutiveFailures: 1, lastStatus: PingStatus.DOWN });

    prisma._tx.alertEvent.findFirst.mockResolvedValue(null);
    prisma._tx.alertEvent.create
      .mockResolvedValueOnce({ id: 'evt-normal' })
      .mockResolvedValueOnce({ id: 'evt-escalation' });

    await service.processHeartbeat(makeHeartbeat(PingStatus.DOWN), monitor);

    // Two AlertEvents created (normal + escalation)
    expect(prisma._tx.alertEvent.create).toHaveBeenCalledTimes(2);

    // Two delivery jobs enqueued
    expect(queue.add).toHaveBeenCalledTimes(2);

    // Second job has isEscalation=true
    expect(queue.add).toHaveBeenCalledWith(
      'deliver-alert',
      expect.objectContaining({ isEscalation: true }),
    );
  });

  // ── 13. Escalation does NOT fire when no escalation channels configured ────

  it('does not enqueue an escalation job when no escalation channels are configured', async () => {
    const settings = makeSettings({ alertThreshold: 2, escalationThreshold: 2 });
    alertSettings.getSettingsForMonitor.mockResolvedValue(settings);
    alertSettings.getChannelsForMonitor.mockResolvedValue([]); // no escalation channels

    const monitor = makeMonitor({ consecutiveFailures: 1, lastStatus: PingStatus.DOWN });

    prisma._tx.alertEvent.findFirst.mockResolvedValue(null);
    prisma._tx.alertEvent.create.mockResolvedValue({ id: 'evt-normal' });

    await service.processHeartbeat(makeHeartbeat(PingStatus.DOWN), monitor);

    // Only one AlertEvent and one job
    expect(prisma._tx.alertEvent.create).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      'deliver-alert',
      expect.objectContaining({ isEscalation: false }),
    );
  });

  // ── 14. Per-monitor threshold used instead of monitor.alertThreshold ───────

  it('uses MonitorAlertSettings.alertThreshold instead of Monitor.alertThreshold', async () => {
    // Settings override: fire at 1 failure, not the monitor's 3
    const settings = makeSettings({ alertThreshold: 1 });
    alertSettings.getSettingsForMonitor.mockResolvedValue(settings);

    const monitor = makeMonitor({
      consecutiveFailures: 0,
      lastStatus: PingStatus.UP,
      alertThreshold: 3, // would require 3 failures without settings override
    });

    prisma._tx.alertEvent.findFirst.mockResolvedValue(null);
    prisma._tx.alertEvent.create.mockResolvedValue({ id: 'evt-1' });

    await service.processHeartbeat(makeHeartbeat(PingStatus.DOWN), monitor);

    // Should fire at 1 failure
    expect(prisma._tx.alertEvent.create).toHaveBeenCalled();
  });
});
