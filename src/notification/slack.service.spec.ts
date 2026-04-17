import { Test, TestingModule } from '@nestjs/testing';
import { SlackDeliveryError, SlackInvalidWebhookError } from './errors/platform.errors';
import { SendSlackAlertParams, SlackService } from './slack.service';

// ── Fixtures ───────────────────────────────────────────────────────────────────

const VALID_SLACK_URL = 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXX';
const NON_SLACK_URL = 'https://discord.com/api/webhooks/123456/abc';
const HTTP_SLACK_URL = 'http://hooks.slack.com/services/T00000000/B00000000/XXX';

const BASE_DOWN_PARAMS: SendSlackAlertParams = {
  webhookUrl: VALID_SLACK_URL,
  monitorName: 'My API',
  monitorUrl: 'https://api.example.com',
  type: 'DOWN',
  triggeredAt: new Date('2026-04-17T12:00:00Z'),
  responseTimeMs: 1234,
  errorMessage: 'Connection refused',
  statusCode: 503,
  dashboardUrl: 'https://pulsee.website/dashboard',
};

const BASE_RECOVERY_PARAMS: SendSlackAlertParams = {
  ...BASE_DOWN_PARAMS,
  type: 'RECOVERY',
  responseTimeMs: 200,
  errorMessage: undefined,
  statusCode: 200,
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeOkResponse(status = 200): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: jest.fn().mockResolvedValue('ok'),
  } as unknown as Response;
}

function makeErrorResponse(status: number, body = 'error'): Response {
  return {
    status,
    ok: false,
    text: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

/**
 * Parses the JSON payload sent to fetch in the first call.
 */
function getPayload(spy: jest.SpyInstance): Record<string, unknown> {
  const [, init] = spy.mock.calls[0] as [string, RequestInit];
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('SlackService', () => {
  let service: SlackService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SlackService],
    }).compile();
    service = module.get<SlackService>(SlackService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── URL validation ───────────────────────────────────────────────────────────

  describe('URL validation', () => {
    it('throws SlackInvalidWebhookError for a Discord URL', async () => {
      await expect(
        service.sendSlackAlert({ ...BASE_DOWN_PARAMS, webhookUrl: NON_SLACK_URL }),
      ).rejects.toBeInstanceOf(SlackInvalidWebhookError);
    });

    it('throws SlackInvalidWebhookError for an HTTP (non-HTTPS) Slack URL', async () => {
      await expect(
        service.sendSlackAlert({ ...BASE_DOWN_PARAMS, webhookUrl: HTTP_SLACK_URL }),
      ).rejects.toBeInstanceOf(SlackInvalidWebhookError);
    });

    it('throws SlackInvalidWebhookError for an arbitrary HTTPS URL', async () => {
      await expect(
        service.sendSlackAlert({ ...BASE_DOWN_PARAMS, webhookUrl: 'https://example.com/webhook' }),
      ).rejects.toBeInstanceOf(SlackInvalidWebhookError);
    });

    it('does not throw for a valid Slack webhook URL', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValueOnce(makeOkResponse());
      await expect(service.sendSlackAlert(BASE_DOWN_PARAMS)).resolves.toBeUndefined();
    });

    it('does not make an HTTP request when the URL is invalid', async () => {
      const spy = jest.spyOn(global, 'fetch');
      await expect(
        service.sendSlackAlert({ ...BASE_DOWN_PARAMS, webhookUrl: NON_SLACK_URL }),
      ).rejects.toBeInstanceOf(SlackInvalidWebhookError);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  // ── Sends to the correct URL ─────────────────────────────────────────────────

  describe('request targeting', () => {
    it('POSTs to the exact webhook URL provided', async () => {
      const spy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(makeOkResponse());
      await service.sendSlackAlert(BASE_DOWN_PARAMS);
      const [calledUrl] = spy.mock.calls[0] as [string, RequestInit];
      expect(calledUrl).toBe(VALID_SLACK_URL);
    });

    it('sets Content-Type: application/json', async () => {
      const spy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(makeOkResponse());
      await service.sendSlackAlert(BASE_DOWN_PARAMS);
      const [, init] = spy.mock.calls[0] as [string, RequestInit];
      expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    });
  });

  // ── DOWN alert payload ───────────────────────────────────────────────────────

  describe('DOWN alert', () => {
    it('uses the correct fallback text', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValueOnce(makeOkResponse());
      const spy = jest.spyOn(global, 'fetch');
      await service.sendSlackAlert(BASE_DOWN_PARAMS);
      const payload = getPayload(spy);
      expect(payload.text).toBe('🔴 My API is DOWN');
    });

    it('builds a header block with the DOWN title', async () => {
      const spy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(makeOkResponse());
      await service.sendSlackAlert(BASE_DOWN_PARAMS);
      const payload = getPayload(spy);
      const header = (payload.blocks as Array<Record<string, unknown>>)[0];
      expect(header.type).toBe('header');
      expect((header.text as Record<string, unknown>).text).toBe('🔴 Monitor Down Alert');
    });

    it('includes the DOWN status indicator in section 1', async () => {
      const spy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(makeOkResponse());
      await service.sendSlackAlert(BASE_DOWN_PARAMS);
      const payload = getPayload(spy);
      const section1 = (payload.blocks as Array<Record<string, unknown>>)[1];
      const fields = section1.fields as Array<{ text: string }>;
      expect(fields.some((f) => f.text.includes('🔴 DOWN'))).toBe(true);
    });

    it('includes the error message in section 1', async () => {
      const spy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(makeOkResponse());
      await service.sendSlackAlert(BASE_DOWN_PARAMS);
      const payload = getPayload(spy);
      const section1 = (payload.blocks as Array<Record<string, unknown>>)[1];
      const fields = section1.fields as Array<{ text: string }>;
      expect(fields.some((f) => f.text.includes('Connection refused'))).toBe(true);
    });

    it('falls back to "No response" when errorMessage is absent', async () => {
      const spy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(makeOkResponse());
      await service.sendSlackAlert({ ...BASE_DOWN_PARAMS, errorMessage: undefined });
      const payload = getPayload(spy);
      const section1 = (payload.blocks as Array<Record<string, unknown>>)[1];
      const fields = section1.fields as Array<{ text: string }>;
      expect(fields.some((f) => f.text.includes('No response'))).toBe(true);
    });

    it('includes the monitor URL as a Slack link in section 1', async () => {
      const spy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(makeOkResponse());
      await service.sendSlackAlert(BASE_DOWN_PARAMS);
      const payload = getPayload(spy);
      const section1 = (payload.blocks as Array<Record<string, unknown>>)[1];
      const fields = section1.fields as Array<{ text: string }>;
      expect(fields.some((f) => f.text.includes('<https://api.example.com|My API>'))).toBe(true);
    });

    it('shows status code in section 2', async () => {
      const spy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(makeOkResponse());
      await service.sendSlackAlert(BASE_DOWN_PARAMS);
      const payload = getPayload(spy);
      const section2 = (payload.blocks as Array<Record<string, unknown>>)[2];
      const fields = section2.fields as Array<{ text: string }>;
      expect(fields.some((f) => f.text.includes('503'))).toBe(true);
    });

    it('uses "danger" button style', async () => {
      const spy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(makeOkResponse());
      await service.sendSlackAlert(BASE_DOWN_PARAMS);
      const payload = getPayload(spy);
      const blocks = payload.blocks as Array<Record<string, unknown>>;
      const actions = blocks.find((b) => b.type === 'actions') as Record<string, unknown>;
      const elements = actions.elements as Array<Record<string, unknown>>;
      expect(elements[0].style).toBe('danger');
    });

    it('shows "Timeout" for response time when responseTimeMs is absent', async () => {
      const spy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(makeOkResponse());
      await service.sendSlackAlert({ ...BASE_DOWN_PARAMS, responseTimeMs: undefined });
      const payload = getPayload(spy);
      const section2 = (payload.blocks as Array<Record<string, unknown>>)[2];
      const fields = section2.fields as Array<{ text: string }>;
      expect(fields.some((f) => f.text.includes('Timeout'))).toBe(true);
    });
  });

  // ── RECOVERY alert payload ───────────────────────────────────────────────────

  describe('RECOVERY alert', () => {
    it('uses the correct fallback text', async () => {
      const spy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(makeOkResponse());
      await service.sendSlackAlert(BASE_RECOVERY_PARAMS);
      const payload = getPayload(spy);
      expect(payload.text).toBe('🟢 My API is back UP');
    });

    it('builds a header block with the RECOVERY title', async () => {
      const spy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(makeOkResponse());
      await service.sendSlackAlert(BASE_RECOVERY_PARAMS);
      const payload = getPayload(spy);
      const header = (payload.blocks as Array<Record<string, unknown>>)[0];
      expect((header.text as Record<string, unknown>).text).toBe('🟢 Monitor Recovered');
    });

    it('includes the UP status indicator in section 1', async () => {
      const spy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(makeOkResponse());
      await service.sendSlackAlert(BASE_RECOVERY_PARAMS);
      const payload = getPayload(spy);
      const section1 = (payload.blocks as Array<Record<string, unknown>>)[1];
      const fields = section1.fields as Array<{ text: string }>;
      expect(fields.some((f) => f.text.includes('🟢 UP'))).toBe(true);
    });

    it('shows response time prominently in section 1', async () => {
      const spy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(makeOkResponse());
      await service.sendSlackAlert(BASE_RECOVERY_PARAMS);
      const payload = getPayload(spy);
      const section1 = (payload.blocks as Array<Record<string, unknown>>)[1];
      const fields = section1.fields as Array<{ text: string }>;
      expect(fields.some((f) => f.text.includes('200ms'))).toBe(true);
    });

    it('uses "primary" button style', async () => {
      const spy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(makeOkResponse());
      await service.sendSlackAlert(BASE_RECOVERY_PARAMS);
      const payload = getPayload(spy);
      const blocks = payload.blocks as Array<Record<string, unknown>>;
      const actions = blocks.find((b) => b.type === 'actions') as Record<string, unknown>;
      const elements = actions.elements as Array<Record<string, unknown>>;
      expect(elements[0].style).toBe('primary');
    });
  });

  // ── HTTP error handling ──────────────────────────────────────────────────────

  describe('delivery error handling', () => {
    it('throws SlackDeliveryError on a non-2xx response', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValueOnce(makeErrorResponse(500));
      await expect(service.sendSlackAlert(BASE_DOWN_PARAMS)).rejects.toBeInstanceOf(
        SlackDeliveryError,
      );
    });

    it('includes the HTTP status code in SlackDeliveryError', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValueOnce(makeErrorResponse(400));
      await expect(service.sendSlackAlert(BASE_DOWN_PARAMS)).rejects.toMatchObject({
        statusCode: 400,
      });
    });

    it('throws SlackDeliveryError on network failure', async () => {
      jest.spyOn(global, 'fetch').mockRejectedValueOnce(new TypeError('Failed to fetch'));
      await expect(service.sendSlackAlert(BASE_DOWN_PARAMS)).rejects.toBeInstanceOf(
        SlackDeliveryError,
      );
    });

    it('throws SlackDeliveryError on timeout (AbortError)', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      jest.spyOn(global, 'fetch').mockRejectedValueOnce(abortError);
      await expect(service.sendSlackAlert(BASE_DOWN_PARAMS)).rejects.toBeInstanceOf(
        SlackDeliveryError,
      );
    });
  });

  // ── Structure invariants ─────────────────────────────────────────────────────

  describe('payload structure invariants', () => {
    it('includes a context block with the Pulse branding link', async () => {
      const spy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(makeOkResponse());
      await service.sendSlackAlert(BASE_DOWN_PARAMS);
      const payload = getPayload(spy);
      const blocks = payload.blocks as Array<Record<string, unknown>>;
      const context = blocks.find((b) => b.type === 'context') as Record<string, unknown>;
      expect(context).toBeDefined();
      const elements = context.elements as Array<{ text: string }>;
      expect(elements[0].text).toContain('pulsee.website');
    });

    it('includes a "View Dashboard" button pointing to the dashboardUrl', async () => {
      const spy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(makeOkResponse());
      await service.sendSlackAlert(BASE_DOWN_PARAMS);
      const payload = getPayload(spy);
      const blocks = payload.blocks as Array<Record<string, unknown>>;
      const actions = blocks.find((b) => b.type === 'actions') as Record<string, unknown>;
      const elements = actions.elements as Array<Record<string, unknown>>;
      expect(elements[0].url).toBe('https://pulsee.website/dashboard');
    });
  });
});
