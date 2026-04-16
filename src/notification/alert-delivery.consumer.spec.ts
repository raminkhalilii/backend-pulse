import { Job } from 'bullmq';
import { AlertChannelType, AlertEventType, DeliveryStatus } from '../../generated/prisma/client';
import { AlertDeliveryPayload } from '../alert/alert-engine.service';
import { AlertDeliveryConsumer } from './alert-delivery.consumer';
import { EmailService } from './email.service';

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const USER_ID = 'user-uuid-1';
const MONITOR_ID = 'monitor-uuid-1';
const ALERT_EVENT_ID = 'alert-event-uuid-1';

const mockUser = {
  id: USER_ID,
  email: 'owner@example.com',
  name: 'Test User',
  password: null,
  refreshToken: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockMonitor = {
  id: MONITOR_ID,
  userId: USER_ID,
  name: 'My Service',
  url: 'https://example.com',
  frequency: 'ONE_MIN' as const,
  isActive: true,
  consecutiveFailures: 3,
  alertThreshold: 2,
  lastAlertedAt: new Date(),
  lastStatus: 'DOWN' as const,
  createdAt: new Date(),
  updatedAt: new Date(),
  user: mockUser,
};

const makeAlertEvent = (type: AlertEventType, metadata: Record<string, unknown> = {}) => ({
  id: ALERT_EVENT_ID,
  monitorId: MONITOR_ID,
  type,
  triggeredAt: new Date('2026-04-16T14:00:00Z'),
  deliveryStatus: DeliveryStatus.PENDING,
  metadata,
  monitor: mockMonitor,
});

const makeChannel = (overrides: Partial<{ id: string; value: string; enabled: boolean }> = {}) => ({
  id: overrides.id ?? 'channel-uuid-1',
  userId: USER_ID,
  type: AlertChannelType.EMAIL,
  value: overrides.value ?? 'alerts@example.com',
  label: null,
  enabled: overrides.enabled ?? true,
  createdAt: new Date(),
  updatedAt: new Date(),
});

function makeJob(payload: AlertDeliveryPayload): Job<AlertDeliveryPayload> {
  return {
    name: 'deliver-alert',
    data: payload,
    attemptsMade: 0,
  } as unknown as Job<AlertDeliveryPayload>;
}

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  alertEvent: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  alertChannel: {
    findMany: jest.fn(),
  },
};

const mockEmailService = {
  sendAlertEmail: jest.fn(),
};

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('AlertDeliveryConsumer', () => {
  let consumer: AlertDeliveryConsumer;

  beforeEach(() => {
    jest.clearAllMocks();
    // Instantiate directly — no Nest DI overhead needed for unit tests.
    consumer = new (AlertDeliveryConsumer as any)(mockPrisma, mockEmailService);
  });

  const JOB_PAYLOAD: AlertDeliveryPayload = {
    alertEventId: ALERT_EVENT_ID,
    monitorId: MONITOR_ID,
    type: AlertEventType.DOWN,
  };

  // ── Happy path: single channel ─────────────────────────────────────────────

  it('sends email to all enabled EMAIL channels and marks AlertEvent as SENT', async () => {
    const channel1 = makeChannel({ id: 'ch-1', value: 'a@example.com' });
    const channel2 = makeChannel({ id: 'ch-2', value: 'b@example.com' });

    mockPrisma.alertEvent.findUnique.mockResolvedValue(makeAlertEvent(AlertEventType.DOWN));
    mockPrisma.alertChannel.findMany.mockResolvedValue([channel1, channel2]);
    mockEmailService.sendAlertEmail.mockResolvedValue(undefined);
    mockPrisma.alertEvent.update.mockResolvedValue({});

    await consumer.process(makeJob(JOB_PAYLOAD));

    expect(mockEmailService.sendAlertEmail).toHaveBeenCalledTimes(2);
    expect(mockEmailService.sendAlertEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'a@example.com', type: 'DOWN' }),
    );
    expect(mockEmailService.sendAlertEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'b@example.com', type: 'DOWN' }),
    );

    expect(mockPrisma.alertEvent.update).toHaveBeenCalledWith({
      where: { id: ALERT_EVENT_ID },
      data: { deliveryStatus: DeliveryStatus.SENT },
    });
  });

  // ── Disabled channels are skipped ─────────────────────────────────────────

  it('only attempts delivery to enabled channels (disabled ones are excluded by the query)', async () => {
    // The query in the consumer filters enabled:true, so the mock just returns
    // only the enabled channel — simulating Prisma's WHERE clause.
    const enabledChannel = makeChannel({ id: 'ch-enabled', value: 'ok@example.com' });

    mockPrisma.alertEvent.findUnique.mockResolvedValue(makeAlertEvent(AlertEventType.DOWN));
    mockPrisma.alertChannel.findMany.mockResolvedValue([enabledChannel]); // disabled excluded
    mockEmailService.sendAlertEmail.mockResolvedValue(undefined);
    mockPrisma.alertEvent.update.mockResolvedValue({});

    await consumer.process(makeJob(JOB_PAYLOAD));

    expect(mockEmailService.sendAlertEmail).toHaveBeenCalledTimes(1);
    expect(mockEmailService.sendAlertEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'ok@example.com' }),
    );
    expect(mockPrisma.alertEvent.update).toHaveBeenCalledWith({
      where: { id: ALERT_EVENT_ID },
      data: { deliveryStatus: DeliveryStatus.SENT },
    });
  });

  // ── All channels succeed → SENT ────────────────────────────────────────────

  it('marks AlertEvent as SENT when all deliveries succeed', async () => {
    mockPrisma.alertEvent.findUnique.mockResolvedValue(
      makeAlertEvent(AlertEventType.RECOVERY, { latencyMs: 120 }),
    );
    mockPrisma.alertChannel.findMany.mockResolvedValue([makeChannel()]);
    mockEmailService.sendAlertEmail.mockResolvedValue(undefined);
    mockPrisma.alertEvent.update.mockResolvedValue({});

    await consumer.process(makeJob({ ...JOB_PAYLOAD, type: AlertEventType.RECOVERY }));

    expect(mockPrisma.alertEvent.update).toHaveBeenCalledWith({
      where: { id: ALERT_EVENT_ID },
      data: { deliveryStatus: DeliveryStatus.SENT },
    });
    // Verify responseTimeMs is forwarded from metadata
    expect(mockEmailService.sendAlertEmail).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'RECOVERY', responseTimeMs: 120 }),
    );
  });

  // ── Any failure → FAILED + rethrow ────────────────────────────────────────

  it('marks AlertEvent as FAILED and rethrows when any delivery fails', async () => {
    const channel1 = makeChannel({ id: 'ch-ok', value: 'ok@example.com' });
    const channel2 = makeChannel({ id: 'ch-fail', value: 'fail@example.com' });

    mockPrisma.alertEvent.findUnique.mockResolvedValue(makeAlertEvent(AlertEventType.DOWN));
    mockPrisma.alertChannel.findMany.mockResolvedValue([channel1, channel2]);
    mockEmailService.sendAlertEmail
      .mockResolvedValueOnce(undefined) // ch-ok succeeds
      .mockRejectedValueOnce(new Error('SMTP timeout')); // ch-fail fails
    mockPrisma.alertEvent.update.mockResolvedValue({});

    await expect(consumer.process(makeJob(JOB_PAYLOAD))).rejects.toThrow(
      'Delivery failed for alertEventId=',
    );

    // Both channels were attempted (fire-and-collect, no short-circuit)
    expect(mockEmailService.sendAlertEmail).toHaveBeenCalledTimes(2);

    // AlertEvent must be marked FAILED
    expect(mockPrisma.alertEvent.update).toHaveBeenCalledWith({
      where: { id: ALERT_EVENT_ID },
      data: { deliveryStatus: DeliveryStatus.FAILED },
    });
  });

  // ── No channels → SENT (no-op) ─────────────────────────────────────────────

  it('marks AlertEvent as SENT without sending any emails when user has no email channels', async () => {
    mockPrisma.alertEvent.findUnique.mockResolvedValue(makeAlertEvent(AlertEventType.DOWN));
    mockPrisma.alertChannel.findMany.mockResolvedValue([]); // no channels

    mockPrisma.alertEvent.update.mockResolvedValue({});

    await consumer.process(makeJob(JOB_PAYLOAD));

    expect(mockEmailService.sendAlertEmail).not.toHaveBeenCalled();
    expect(mockPrisma.alertEvent.update).toHaveBeenCalledWith({
      where: { id: ALERT_EVENT_ID },
      data: { deliveryStatus: DeliveryStatus.SENT },
    });
  });

  // ── AlertEvent not found ───────────────────────────────────────────────────

  it('returns without throwing when AlertEvent is not found (already deleted)', async () => {
    mockPrisma.alertEvent.findUnique.mockResolvedValue(null);

    await expect(consumer.process(makeJob(JOB_PAYLOAD))).resolves.toBeUndefined();

    expect(mockEmailService.sendAlertEmail).not.toHaveBeenCalled();
    expect(mockPrisma.alertEvent.update).not.toHaveBeenCalled();
  });

  // ── Unknown job name ───────────────────────────────────────────────────────

  it('does nothing when job name is not "deliver-alert"', async () => {
    const unknownJob = {
      name: 'some-other-job',
      data: JOB_PAYLOAD,
      attemptsMade: 0,
    } as unknown as Job<AlertDeliveryPayload>;

    await expect(consumer.process(unknownJob)).resolves.toBeUndefined();

    expect(mockPrisma.alertEvent.findUnique).not.toHaveBeenCalled();
    expect(mockEmailService.sendAlertEmail).not.toHaveBeenCalled();
  });
});
