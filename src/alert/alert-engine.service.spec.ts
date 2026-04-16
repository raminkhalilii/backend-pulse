import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import {
  AlertEventType,
  Heartbeat,
  Monitor,
  MonitorFrequency,
  PingStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma';
import { ALERT_DELIVERY_QUEUE } from '../queue/queue.constants';
import { AlertDeliveryPayload, AlertEngineService } from './alert-engine.service';

// ── Test-double factories ────────────────────────────────────────────────────

// overrides is Partial<Monitor> so every spread value is known to TypeScript
// and the return type is exactly Monitor — no implicit any, no as-any casts.
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

// ── Prisma mock ───────────────────────────────────────────────────────────────
// The mock executes the $transaction callback synchronously with txMock so all
// assertions can reference txMock.alertEvent / txMock.monitor directly.
// The callback return type is Promise<unknown> to accommodate any return shape
// (the service's $transaction now returns AlertDeliveryPayload | null).

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

  const prismaMock = {
    $transaction: jest.fn(async (cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock)),
    // Expose txMock so tests can set return values and verify calls
    _tx: txMock,
  };

  return prismaMock;
}

// ── Queue mock ────────────────────────────────────────────────────────────────

function makeQueueMock() {
  return { add: jest.fn().mockResolvedValue({}) };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('AlertEngineService', () => {
  let service: AlertEngineService;
  let prisma: ReturnType<typeof makePrismaMock>;
  let queue: ReturnType<typeof makeQueueMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();
    queue = makeQueueMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlertEngineService,
        { provide: PrismaService, useValue: prisma },
        { provide: getQueueToken(ALERT_DELIVERY_QUEUE), useValue: queue },
      ],
    }).compile();

    service = module.get<AlertEngineService>(AlertEngineService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── 1. DOWN alert fires when threshold is reached ─────────────────────────

  it('fires a DOWN alert when consecutiveFailures reaches alertThreshold', async () => {
    // Monitor has already seen 1 failure. This heartbeat is the 2nd DOWN,
    // making consecutiveFailures = 2 = alertThreshold.
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

    prisma._tx.alertEvent.findFirst.mockResolvedValue(null); // no open alert
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

  // ── 2. DOWN alert does NOT fire before threshold is reached ───────────────

  it('does not fire a DOWN alert when consecutiveFailures < alertThreshold', async () => {
    // First ever DOWN — consecutiveFailures becomes 1, threshold is 2.
    const monitor = makeMonitor({
      consecutiveFailures: 0,
      lastStatus: PingStatus.UP,
      alertThreshold: 2,
    });
    const heartbeat = makeHeartbeat(PingStatus.DOWN);

    await service.processHeartbeat(heartbeat, monitor);

    expect(prisma._tx.alertEvent.create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
    // Monitor state must still be updated
    expect(prisma._tx.monitor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ consecutiveFailures: 1, lastStatus: PingStatus.DOWN }),
      }),
    );
  });

  // ── 3. DOWN alert does NOT fire twice for the same ongoing outage ──────────

  it('does not fire a second DOWN alert when an open outage already exists', async () => {
    // Enough consecutive failures to pass the threshold gate
    const monitor = makeMonitor({
      consecutiveFailures: 2,
      lastStatus: PingStatus.DOWN,
      alertThreshold: 2,
    });
    const heartbeat = makeHeartbeat(PingStatus.DOWN);

    // Simulate an existing open DOWN alert (most recent event is DOWN)
    prisma._tx.alertEvent.findFirst.mockResolvedValue({
      id: 'evt-existing',
      type: AlertEventType.DOWN,
    });

    await service.processHeartbeat(heartbeat, monitor);

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
    const heartbeat = makeHeartbeat(PingStatus.UP);

    prisma._tx.alertEvent.create.mockResolvedValue({ id: 'evt-recovery' });

    await service.processHeartbeat(heartbeat, monitor);

    expect(prisma._tx.alertEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: AlertEventType.RECOVERY }),
      }),
    );
    expect(queue.add).toHaveBeenCalledWith(
      'deliver-alert',
      expect.objectContaining({ alertEventId: 'evt-recovery', type: AlertEventType.RECOVERY }),
    );
  });

  // ── 5. RECOVERY does NOT fire if the monitor was already UP ───────────────

  it('does not fire a RECOVERY alert when lastStatus is already UP', async () => {
    const monitor = makeMonitor({
      consecutiveFailures: 0,
      lastStatus: PingStatus.UP,
      alertThreshold: 2,
    });
    const heartbeat = makeHeartbeat(PingStatus.UP);

    await service.processHeartbeat(heartbeat, monitor);

    expect(prisma._tx.alertEvent.create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  // ── 6. consecutiveFailures resets to 0 on recovery ────────────────────────

  it('resets consecutiveFailures to 0 when heartbeat is UP', async () => {
    const monitor = makeMonitor({
      consecutiveFailures: 5,
      lastStatus: PingStatus.DOWN,
      alertThreshold: 2,
    });
    const heartbeat = makeHeartbeat(PingStatus.UP);

    prisma._tx.alertEvent.create.mockResolvedValue({ id: 'evt-r' });

    await service.processHeartbeat(heartbeat, monitor);

    expect(prisma._tx.monitor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ consecutiveFailures: 0 }),
      }),
    );
  });

  // ── 7. Queue failure leaves AlertEvent PENDING and does NOT throw ──────────

  it('does not throw when alertQueue.add rejects', async () => {
    const monitor = makeMonitor({
      consecutiveFailures: 1,
      lastStatus: PingStatus.DOWN,
      alertThreshold: 2,
    });
    const heartbeat = makeHeartbeat(PingStatus.DOWN);

    prisma._tx.alertEvent.findFirst.mockResolvedValue(null);
    prisma._tx.alertEvent.create.mockResolvedValue({ id: 'evt-1' });
    queue.add.mockRejectedValue(new Error('Redis connection refused'));

    await expect(service.processHeartbeat(heartbeat, monitor)).resolves.not.toThrow();

    // AlertEvent was created in DB (PENDING) even though enqueue failed
    expect(prisma._tx.alertEvent.create).toHaveBeenCalled();
  });
});
