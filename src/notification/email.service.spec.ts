import { Test, TestingModule } from '@nestjs/testing';
import { EmailService, SendAlertEmailParams } from './email.service';

// ─── Mock the entire resend module ───────────────────────────────────────────
// We intercept the Resend constructor so every test controls what
// `resend.emails.send` returns without any real HTTP calls.

const mockEmailsSend = jest.fn();

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: mockEmailsSend },
  })),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BASE_PARAMS: SendAlertEmailParams = {
  to: 'user@example.com',
  monitorName: 'My API',
  monitorUrl: 'https://api.example.com/health',
  triggeredAt: new Date('2026-04-16T14:32:00.000Z'),
  dashboardUrl: 'https://pulsee.website/dashboard',
  type: 'DOWN', // overridden per test
};

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('EmailService', () => {
  let service: EmailService;

  beforeEach(async () => {
    // Reset mock state between tests
    mockEmailsSend.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [EmailService],
    }).compile();

    service = module.get<EmailService>(EmailService);
  });

  // ── DOWN alert ─────────────────────────────────────────────────────────────

  describe('sendAlertEmail — DOWN type', () => {
    it('calls Resend SDK with correct recipient, subject, and content', async () => {
      mockEmailsSend.mockResolvedValue({ data: { id: 'msg-001' }, error: null });

      await service.sendAlertEmail({
        ...BASE_PARAMS,
        type: 'DOWN',
        errorMessage: 'Connection refused',
      });

      expect(mockEmailsSend).toHaveBeenCalledTimes(1);
      const call = mockEmailsSend.mock.calls[0][0] as Record<string, unknown>;

      // Recipient
      expect(call.to).toEqual(['user@example.com']);

      // Subject must contain the right emoji, monitor name, and status word
      expect(call.subject).toContain('🔴');
      expect(call.subject).toContain('My API');
      expect(call.subject).toContain('DOWN');

      // HTML body must include key data
      expect(typeof call.html).toBe('string');
      const html = call.html as string;
      expect(html).toContain('My API');
      expect(html).toContain('https://api.example.com/health');
      expect(html).toContain('Connection refused');
      expect(html).toContain('April 16, 2026');
      expect(html).toContain('14:32 UTC');
      expect(html).toContain('https://pulsee.website/dashboard');

      // Plain-text fallback must be present and non-empty
      expect(typeof call.text).toBe('string');
      expect((call.text as string).length).toBeGreaterThan(0);
      expect(call.text).toContain('DOWN');
      expect(call.text).toContain('Connection refused');
    });

    it('omits error row when errorMessage is not provided', async () => {
      mockEmailsSend.mockResolvedValue({ data: { id: 'msg-002' }, error: null });

      await service.sendAlertEmail({ ...BASE_PARAMS, type: 'DOWN' });

      const html = mockEmailsSend.mock.calls[0][0].html as string;
      // "Error" table row should not appear when there's no errorMessage
      expect(html).not.toMatch(/>\s*Error\s*<\/td>/);
    });
  });

  // ── RECOVERY alert ─────────────────────────────────────────────────────────

  describe('sendAlertEmail — RECOVERY type', () => {
    it('calls Resend SDK with correct recipient, subject, and content', async () => {
      mockEmailsSend.mockResolvedValue({ data: { id: 'msg-003' }, error: null });

      await service.sendAlertEmail({
        ...BASE_PARAMS,
        type: 'RECOVERY',
        responseTimeMs: 243,
      });

      expect(mockEmailsSend).toHaveBeenCalledTimes(1);
      const call = mockEmailsSend.mock.calls[0][0] as Record<string, unknown>;

      // Recipient
      expect(call.to).toEqual(['user@example.com']);

      // Subject
      expect(call.subject).toContain('🟢');
      expect(call.subject).toContain('My API');
      expect(call.subject).toContain('UP');

      // HTML must include response time and monitor URL
      const html = call.html as string;
      expect(html).toContain('243');
      expect(html).toContain('https://api.example.com/health');
      expect(html).toContain('April 16, 2026');
      expect(html).toContain('14:32 UTC');
      expect(html).toContain('https://pulsee.website/dashboard');

      // Plain-text fallback
      expect(call.text).toContain('UP');
      expect(call.text).toContain('243');
    });

    it('omits response-time row when responseTimeMs is not provided', async () => {
      mockEmailsSend.mockResolvedValue({ data: { id: 'msg-004' }, error: null });

      await service.sendAlertEmail({ ...BASE_PARAMS, type: 'RECOVERY' });

      const html = mockEmailsSend.mock.calls[0][0].html as string;
      // "Response time" row should not appear
      expect(html).not.toMatch(/Response time/);
    });
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  describe('sendAlertEmail — error handling', () => {
    it('throws a typed Error when Resend returns a non-2xx error object', async () => {
      mockEmailsSend.mockResolvedValue({
        data: null,
        error: {
          name: 'validation_error',
          message: 'Invalid API key',
          statusCode: 403,
        },
      });

      await expect(service.sendAlertEmail({ ...BASE_PARAMS, type: 'DOWN' })).rejects.toThrow(
        'Invalid API key',
      );
    });

    it('re-throws when Resend SDK itself throws (network failure)', async () => {
      mockEmailsSend.mockRejectedValue(new Error('fetch failed'));

      await expect(service.sendAlertEmail({ ...BASE_PARAMS, type: 'DOWN' })).rejects.toThrow(
        'fetch failed',
      );
    });
  });
});
