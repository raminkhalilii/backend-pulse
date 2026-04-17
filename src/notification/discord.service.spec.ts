import { Test, TestingModule } from '@nestjs/testing';
import { DiscordDeliveryError, DiscordInvalidWebhookError } from './errors/platform.errors';
import { DiscordService, SendDiscordAlertParams } from './discord.service';

// ── Fixtures ───────────────────────────────────────────────────────────────────

const VALID_DISCORD_URL = 'https://discord.com/api/webhooks/1234567890/abcdefghijklmnopqrstuvwxyz';
const VALID_DISCORDAPP_URL =
  'https://discordapp.com/api/webhooks/1234567890/abcdefghijklmnopqrstuvwxyz';
const SLACK_URL = 'https://hooks.slack.com/services/T00000000/B00000000/XXX';
const ARBITRARY_URL = 'https://example.com/webhook';

const BASE_DOWN_PARAMS: SendDiscordAlertParams = {
  webhookUrl: VALID_DISCORD_URL,
  monitorName: 'Production API',
  monitorUrl: 'https://api.example.com',
  type: 'DOWN',
  triggeredAt: new Date('2026-04-17T12:00:00Z'),
  responseTimeMs: undefined,
  errorMessage: 'Connection timed out',
  statusCode: undefined,
  dashboardUrl: 'https://pulsee.website/dashboard',
};

const BASE_RECOVERY_PARAMS: SendDiscordAlertParams = {
  ...BASE_DOWN_PARAMS,
  type: 'RECOVERY',
  responseTimeMs: 142,
  errorMessage: undefined,
  statusCode: 200,
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeOkResponse(status = 204): Response {
  return {
    status,
    ok: true,
    headers: { get: () => null },
    text: jest.fn().mockResolvedValue(''),
  } as unknown as Response;
}

function makeErrorResponse(status: number, body = 'error'): Response {
  return {
    status,
    ok: false,
    headers: { get: () => null },
    text: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function makeRateLimitResponse(retryAfterSec = '0'): Response {
  return {
    status: 429,
    ok: false,
    headers: { get: (name: string) => (name === 'Retry-After' ? retryAfterSec : null) },
    text: jest.fn().mockResolvedValue('{"retry_after":0,"global":false}'),
  } as unknown as Response;
}

/**
 * Parses the JSON payload sent to fetch in the specified call index (default 0).
 */
function getPayload(spy: jest.SpyInstance, callIndex = 0): Record<string, unknown> {
  const [, init] = spy.mock.calls[callIndex] as [string, RequestInit];
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('DiscordService', () => {
  let service: DiscordService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DiscordService],
    }).compile();
    service = module.get<DiscordService>(DiscordService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── URL validation ───────────────────────────────────────────────────────────

  describe('URL validation', () => {
    it('throws DiscordInvalidWebhookError for a Slack URL', async () => {
      await expect(
        service.sendDiscordAlert({ ...BASE_DOWN_PARAMS, webhookUrl: SLACK_URL }),
      ).rejects.toBeInstanceOf(DiscordInvalidWebhookError);
    });

    it('throws DiscordInvalidWebhookError for an arbitrary HTTPS URL', async () => {
      await expect(
        service.sendDiscordAlert({ ...BASE_DOWN_PARAMS, webhookUrl: ARBITRARY_URL }),
      ).rejects.toBeInstanceOf(DiscordInvalidWebhookError);
    });

    it('does not throw for a discord.com webhook URL', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValueOnce(makeOkResponse());
      await expect(service.sendDiscordAlert(BASE_DOWN_PARAMS)).resolves.toBeUndefined();
    });

    it('does not throw for a discordapp.com webhook URL', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValueOnce(makeOkResponse());
      await expect(
        service.sendDiscordAlert({ ...BASE_DOWN_PARAMS, webhookUrl: VALID_DISCORDAPP_URL }),
      ).resolves.toBeUndefined();
    });

    it('does not make an HTTP request when the URL is invalid', async () => {
      const spy = jest.spyOn(global, 'fetch');
      await expect(
        service.sendDiscordAlert({ ...BASE_DOWN_PARAMS, webhookUrl: SLACK_URL }),
      ).rejects.toBeInstanceOf(DiscordInvalidWebhookError);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  // ── Sends to the correct URL ─────────────────────────────────────────────────

  describe('request targeting', () => {
    it('POSTs to the exact webhook URL provided', async () => {
      const spy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(makeOkResponse());
      await service.sendDiscordAlert(BASE_DOWN_PARAMS);
      const [calledUrl] = spy.mock.calls[0] as [string, RequestInit];
      expect(calledUrl).toBe(VALID_DISCORD_URL);
    });

    it('sets Content-Type: application/json', async () => {
      const spy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(makeOkResponse());
      await service.sendDiscordAlert(BASE_DOWN_PARAMS);
      const [, init] = spy.mock.calls[0] as [string, RequestInit];
      expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    });
  });

  // ── DOWN alert embed ─────────────────────────────────────────────────────────

  describe('DOWN alert embed', () => {
    it('uses the red color (0xE74C3C = 15158332)', async () => {
      const spy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(makeOkResponse());
      await service.sendDiscordAlert(BASE_DOWN_PARAMS);
      const payload = getPayload(spy);
      const embed = (payload.embeds as Array<Record<string, unknown>>)[0];
      expect(embed.color).toBe(15_158_332);
    });

    it('uses "Production API is DOWN" as the embed title', async () => {
      const spy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(makeOkResponse());
      await service.sendDiscordAlert(BASE_DOWN_PARAMS);
      const payload = getPayload(spy);
      const embed = (payload.embeds as Array<Record<string, unknown>>)[0];
      expect(embed.title).toBe('🔴 Production API is DOWN');
    });

    it('includes the "gone offline" description for DOWN', async () => {
      const spy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(makeOkResponse());
      await service.sendDiscordAlert(BASE_DOWN_PARAMS);
      const payload = getPayload(spy);
      const embed = (payload.embeds as Array<Record<string, unknown>>)[0];
      expect(embed.description).toContain('gone offline');
    });

    it('includes the error message in the fields', async () => {
      const spy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(makeOkResponse());
      await service.sendDiscordAlert(BASE_DOWN_PARAMS);
      const payload = getPayload(spy);
      const embed = (payload.embeds as Array<Record<string, unknown>>)[0];
      const fields = embed.fields as Array<{ name: string; value: string }>;
      const errorField = fields.find((f) => f.name.includes('Error'));
      expect(errorField).toBeDefined();
      expect(errorField!.value).toBe('Connection timed out');
    });

    it('falls back to "Connection refused" when errorMessage is absent', async () => {
      const spy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(makeOkResponse());
      await service.sendDiscordAlert({ ...BASE_DOWN_PARAMS, errorMessage: undefined });
      const payload = getPayload(spy);
      const embed = (payload.embeds as Array<Record<string, unknown>>)[0];
      const fields = embed.fields as Array<{ name: string; value: string }>;
      const errorField = fields.find((f) => f.name.includes('Error'));
      expect(errorField!.value).toBe('Connection refused');
    });

    it('shows "No Response" for status code when absent', async () => {
      const spy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(makeOkResponse());
      await service.sendDiscordAlert({ ...BASE_DOWN_PARAMS, statusCode: undefined });
      const payload = getPayload(spy);
      const embed = (payload.embeds as Array<Record<string, unknown>>)[0];
      const fields = embed.fields as Array<{ name: string; value: string }>;
      const statusField = fields.find((f) => f.name.includes('Status Code'));
      expect(statusField!.value).toBe('No Response');
    });

    it('shows "Timeout" for response time when absent', async () => {
      const spy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(makeOkResponse());
      await service.sendDiscordAlert({ ...BASE_DOWN_PARAMS, responseTimeMs: undefined });
      const payload = getPayload(spy);
      const embed = (payload.embeds as Array<Record<string, unknown>>)[0];
      const fields = embed.fields as Array<{ name: string; value: string }>;
      const rtField = fields.find((f) => f.name.includes('Response Time'));
      expect(rtField!.value).toBe('Timeout');
    });
  });

  // ── RECOVERY alert embed ─────────────────────────────────────────────────────

  describe('RECOVERY alert embed', () => {
    it('uses the green color (0x2ECC71 = 3066993)', async () => {
      const spy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(makeOkResponse());
      await service.sendDiscordAlert(BASE_RECOVERY_PARAMS);
      const payload = getPayload(spy);
      const embed = (payload.embeds as Array<Record<string, unknown>>)[0];
      expect(embed.color).toBe(3_066_993);
    });

    it('uses "Production API is back UP" as the embed title', async () => {
      const spy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(makeOkResponse());
      await service.sendDiscordAlert(BASE_RECOVERY_PARAMS);
      const payload = getPayload(spy);
      const embed = (payload.embeds as Array<Record<string, unknown>>)[0];
      expect(embed.title).toBe('🟢 Production API is back UP');
    });

    it('includes the "responding normally" description for RECOVERY', async () => {
      const spy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(makeOkResponse());
      await service.sendDiscordAlert(BASE_RECOVERY_PARAMS);
      const payload = getPayload(spy);
      const embed = (payload.embeds as Array<Record<string, unknown>>)[0];
      expect(embed.description).toContain('responding normally');
    });

    it('shows the response time in the fields', async () => {
      const spy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(makeOkResponse());
      await service.sendDiscordAlert(BASE_RECOVERY_PARAMS);
      const payload = getPayload(spy);
      const embed = (payload.embeds as Array<Record<string, unknown>>)[0];
      const fields = embed.fields as Array<{ name: string; value: string }>;
      const rtField = fields.find((f) => f.name.includes('Response Time'));
      expect(rtField!.value).toBe('142ms');
    });

    it('does NOT include an error field for RECOVERY', async () => {
      const spy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(makeOkResponse());
      await service.sendDiscordAlert(BASE_RECOVERY_PARAMS);
      const payload = getPayload(spy);
      const embed = (payload.embeds as Array<Record<string, unknown>>)[0];
      const fields = embed.fields as Array<{ name: string; value: string }>;
      expect(fields.find((f) => f.name.includes('Error'))).toBeUndefined();
    });
  });

  // ── Rate limit handling ──────────────────────────────────────────────────────

  describe('429 rate limit handling', () => {
    it('retries once after receiving a 429 and succeeds', async () => {
      const spy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(makeRateLimitResponse('0'))
        .mockResolvedValueOnce(makeOkResponse());

      await expect(service.sendDiscordAlert(BASE_DOWN_PARAMS)).resolves.toBeUndefined();
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it('sends the same payload on the retry as on the first attempt', async () => {
      const spy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(makeRateLimitResponse('0'))
        .mockResolvedValueOnce(makeOkResponse());

      await service.sendDiscordAlert(BASE_DOWN_PARAMS);

      const payload1 = getPayload(spy, 0);
      const payload2 = getPayload(spy, 1);
      expect(JSON.stringify(payload1)).toBe(JSON.stringify(payload2));
    });

    it('throws DiscordDeliveryError when the retry also fails with non-2xx', async () => {
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(makeRateLimitResponse('0'))
        .mockResolvedValueOnce(makeErrorResponse(500));

      await expect(service.sendDiscordAlert(BASE_DOWN_PARAMS)).rejects.toBeInstanceOf(
        DiscordDeliveryError,
      );
    });

    it('reads the Retry-After header value (uses 1s default when header is absent)', async () => {
      // Spy on setTimeout to verify it was called — we use Retry-After '0' so no real wait
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(makeRateLimitResponse('0'))
        .mockResolvedValueOnce(makeOkResponse());

      await service.sendDiscordAlert(BASE_DOWN_PARAMS);

      // setTimeout should have been called with 0ms (Retry-After: '0')
      const wasCalled = setTimeoutSpy.mock.calls.some(([, delay]) => delay === 0);
      expect(wasCalled).toBe(true);
    });
  });

  // ── HTTP error handling ──────────────────────────────────────────────────────

  describe('delivery error handling', () => {
    it('throws DiscordDeliveryError on a non-2xx response (no retry for non-429)', async () => {
      const spy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(makeErrorResponse(500));
      await expect(service.sendDiscordAlert(BASE_DOWN_PARAMS)).rejects.toBeInstanceOf(
        DiscordDeliveryError,
      );
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('includes the HTTP status code in DiscordDeliveryError', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValueOnce(makeErrorResponse(403));
      await expect(service.sendDiscordAlert(BASE_DOWN_PARAMS)).rejects.toMatchObject({
        statusCode: 403,
      });
    });

    it('throws DiscordDeliveryError on network failure', async () => {
      jest.spyOn(global, 'fetch').mockRejectedValueOnce(new TypeError('Failed to fetch'));
      await expect(service.sendDiscordAlert(BASE_DOWN_PARAMS)).rejects.toBeInstanceOf(
        DiscordDeliveryError,
      );
    });

    it('throws DiscordDeliveryError on timeout (AbortError)', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      jest.spyOn(global, 'fetch').mockRejectedValueOnce(abortError);
      await expect(service.sendDiscordAlert(BASE_DOWN_PARAMS)).rejects.toBeInstanceOf(
        DiscordDeliveryError,
      );
    });
  });

  // ── Structure invariants ─────────────────────────────────────────────────────

  describe('payload structure invariants', () => {
    it('sets username to "Pulse Alerts"', async () => {
      const spy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(makeOkResponse());
      await service.sendDiscordAlert(BASE_DOWN_PARAMS);
      const payload = getPayload(spy);
      expect(payload.username).toBe('Pulse Alerts');
    });

    it('includes a link button pointing to the dashboardUrl', async () => {
      const spy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(makeOkResponse());
      await service.sendDiscordAlert(BASE_DOWN_PARAMS);
      const payload = getPayload(spy);
      const components = payload.components as Array<{
        type: number;
        components: Array<{ url: string }>;
      }>;
      expect(components[0].type).toBe(1);
      expect(components[0].components[0].url).toBe('https://pulsee.website/dashboard');
    });

    it('sets the embed timestamp to the triggeredAt ISO string', async () => {
      const spy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(makeOkResponse());
      await service.sendDiscordAlert(BASE_DOWN_PARAMS);
      const payload = getPayload(spy);
      const embed = (payload.embeds as Array<Record<string, unknown>>)[0];
      expect(embed.timestamp).toBe('2026-04-17T12:00:00.000Z');
    });

    it('sets embed.url to the monitor URL', async () => {
      const spy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(makeOkResponse());
      await service.sendDiscordAlert(BASE_DOWN_PARAMS);
      const payload = getPayload(spy);
      const embed = (payload.embeds as Array<Record<string, unknown>>)[0];
      expect(embed.url).toBe('https://api.example.com');
    });
  });
});
