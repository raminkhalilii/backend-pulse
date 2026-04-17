import * as crypto from 'node:crypto';
import {
  WebhookNetworkError,
  WebhookResponseError,
  WebhookTimeoutError,
} from './errors/webhook.errors';
import { WebhookSecurityService } from './webhook-security.service';
import { WebhookService } from './webhook.service';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal valid DOWN alert param set. */
function makeDownParams(
  overrides: Partial<Parameters<WebhookService['sendWebhookAlert']>[0]> = {},
) {
  return {
    url: 'https://example.com/webhook',
    monitorId: 'mon-1',
    monitorName: 'My Monitor',
    monitorUrl: 'https://my-site.com',
    type: 'DOWN' as const,
    triggeredAt: new Date('2026-01-01T00:00:00Z'),
    responseTimeMs: 320,
    errorMessage: 'Connection refused',
    statusCode: 503,
    ...overrides,
  };
}

/** Creates a mock Response with the given status. */
function mockResponse(status: number, body = ''): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

// ── Test suite ─────────────────────────────────────────────────────────────────

describe('WebhookService', () => {
  let service: WebhookService;
  let securityService: jest.Mocked<WebhookSecurityService>;

  beforeEach(() => {
    // Security service is a pass-through for all webhook.service tests
    securityService = {
      validateWebhookUrl: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<WebhookSecurityService>;

    service = new WebhookService(securityService);

    // Reset the global fetch mock before each test
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── Payload structure ──────────────────────────────────────────────────────

  describe('payload structure', () => {
    it('builds correct JSON structure for a DOWN event', async () => {
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse(200));

      const params = makeDownParams();
      await service.sendWebhookAlert(params);

      const callArgs = (global.fetch as jest.Mock).mock.calls[0];
      const sentBody = JSON.parse(callArgs[1].body as string);

      expect(sentBody.event).toBe('monitor.down');
      expect(sentBody.timestamp).toBeDefined();
      expect(sentBody.monitor).toEqual({
        id: 'mon-1',
        name: 'My Monitor',
        url: 'https://my-site.com',
      });
      expect(sentBody.alert).toEqual({
        type: 'DOWN',
        triggeredAt: '2026-01-01T00:00:00.000Z',
        responseTimeMs: 320,
        errorMessage: 'Connection refused',
        statusCode: 503,
      });
    });

    it('builds correct JSON structure for a RECOVERY event', async () => {
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse(200));

      await service.sendWebhookAlert(
        makeDownParams({
          type: 'RECOVERY',
          responseTimeMs: 150,
          errorMessage: undefined,
          statusCode: undefined,
        }),
      );

      const callArgs = (global.fetch as jest.Mock).mock.calls[0];
      const sentBody = JSON.parse(callArgs[1].body as string);

      expect(sentBody.event).toBe('monitor.recovery');
      expect(sentBody.alert.type).toBe('RECOVERY');
      expect(sentBody.alert.responseTimeMs).toBe(150);
      expect(sentBody.alert.errorMessage).toBeNull();
      expect(sentBody.alert.statusCode).toBeNull();
    });

    it('sets responseTimeMs, errorMessage, and statusCode to null when not provided', async () => {
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse(200));

      await service.sendWebhookAlert(
        makeDownParams({
          responseTimeMs: undefined,
          errorMessage: undefined,
          statusCode: undefined,
        }),
      );

      const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body as string);
      expect(body.alert.responseTimeMs).toBeNull();
      expect(body.alert.errorMessage).toBeNull();
      expect(body.alert.statusCode).toBeNull();
    });
  });

  // ── HMAC signing ───────────────────────────────────────────────────────────

  describe('HMAC signing', () => {
    it('attaches X-Pulse-Signature header when secret is provided', async () => {
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse(200));

      const secret = 'my-super-secret';
      await service.sendWebhookAlert(makeDownParams({ secret }));

      const callArgs = (global.fetch as jest.Mock).mock.calls[0];
      const sentHeaders = callArgs[1].headers as Record<string, string>;
      const sentBody = callArgs[1].body as string;

      const expectedSignature =
        'sha256=' + crypto.createHmac('sha256', secret).update(sentBody).digest('hex');

      expect(sentHeaders['X-Pulse-Signature']).toBe(expectedSignature);
    });

    it('does NOT attach X-Pulse-Signature when no secret is provided', async () => {
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse(200));

      await service.sendWebhookAlert(makeDownParams({ secret: undefined }));

      const callArgs = (global.fetch as jest.Mock).mock.calls[0];
      const sentHeaders = callArgs[1].headers as Record<string, string>;

      expect(sentHeaders['X-Pulse-Signature']).toBeUndefined();
    });

    it('attaches X-Pulse-Timestamp header on every request', async () => {
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse(200));

      await service.sendWebhookAlert(makeDownParams());

      const callArgs = (global.fetch as jest.Mock).mock.calls[0];
      const sentHeaders = callArgs[1].headers as Record<string, string>;

      expect(sentHeaders['X-Pulse-Timestamp']).toMatch(/^\d+$/);
    });

    it('always sets correct Content-Type and User-Agent', async () => {
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse(200));

      await service.sendWebhookAlert(makeDownParams());

      const headers = (global.fetch as jest.Mock).mock.calls[0][1].headers as Record<
        string,
        string
      >;
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['User-Agent']).toBe('Pulse-Webhook/1.0');
    });
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  describe('error handling', () => {
    it('throws WebhookTimeoutError when fetch is aborted', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(
        Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
      );

      await expect(service.sendWebhookAlert(makeDownParams())).rejects.toThrow(WebhookTimeoutError);
    });

    it('throws WebhookResponseError on a 4xx response', async () => {
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse(404, 'Not Found'));

      await expect(service.sendWebhookAlert(makeDownParams())).rejects.toThrow(
        WebhookResponseError,
      );
    });

    it('throws WebhookResponseError on a 5xx response', async () => {
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse(503, 'Service Unavailable'));

      const error = await service
        .sendWebhookAlert(makeDownParams())
        .catch((e: unknown) => e as WebhookResponseError);

      expect(error).toBeInstanceOf(WebhookResponseError);
      expect(error.statusCode).toBe(503);
    });

    it('throws WebhookResponseError on a 3xx response (redirects not followed)', async () => {
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse(301, ''));

      await expect(service.sendWebhookAlert(makeDownParams())).rejects.toThrow(
        WebhookResponseError,
      );
    });

    it('throws WebhookNetworkError on a generic network failure', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(service.sendWebhookAlert(makeDownParams())).rejects.toThrow(WebhookNetworkError);
    });

    it('succeeds silently on any 2xx status', async () => {
      for (const status of [200, 201, 204]) {
        (global.fetch as jest.Mock).mockResolvedValue(mockResponse(status));
        await expect(service.sendWebhookAlert(makeDownParams())).resolves.toBeUndefined();
      }
    });
  });

  // ── sendTestWebhook ────────────────────────────────────────────────────────

  describe('sendTestWebhook', () => {
    it('returns success=true with statusCode on 2xx', async () => {
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse(200));

      const result = await service.sendTestWebhook('https://example.com/hook');

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('returns success=false with statusCode on 4xx without throwing', async () => {
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse(422, 'Unprocessable'));

      const result = await service.sendTestWebhook('https://example.com/hook');

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(422);
    });

    it('returns success=false with statusCode=0 on timeout without throwing', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(
        Object.assign(new Error('aborted'), { name: 'AbortError' }),
      );

      const result = await service.sendTestWebhook('https://example.com/hook');

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(0);
    });

    it('sends event=monitor.test in the test payload', async () => {
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse(200));

      await service.sendTestWebhook('https://example.com/hook');

      const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body as string);
      expect(body.event).toBe('monitor.test');
    });

    it('attaches HMAC signature for test payload when secret is provided', async () => {
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse(200));

      const secret = 'test-secret';
      await service.sendTestWebhook('https://example.com/hook', secret);

      const callArgs = (global.fetch as jest.Mock).mock.calls[0];
      const headers = callArgs[1].headers as Record<string, string>;
      const body = callArgs[1].body as string;

      const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
      expect(headers['X-Pulse-Signature']).toBe(expected);
    });
  });
});
