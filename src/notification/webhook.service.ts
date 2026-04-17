import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'node:crypto';
import {
  WebhookDeliveryError,
  WebhookNetworkError,
  WebhookResponseError,
  WebhookTimeoutError,
} from './errors/webhook.errors';
import { WebhookSecurityService } from './webhook-security.service';

/** How long (ms) to wait for a webhook response before aborting. */
const WEBHOOK_TIMEOUT_MS = 10_000;

export interface SendWebhookAlertParams {
  url: string;
  secret?: string;
  monitorId: string;
  monitorName: string;
  monitorUrl: string;
  type: 'DOWN' | 'RECOVERY';
  triggeredAt: Date;
  responseTimeMs?: number;
  errorMessage?: string;
  statusCode?: number;
}

export interface WebhookTestResult {
  success: boolean;
  statusCode: number;
  responseTimeMs: number;
}

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(private readonly securityService: WebhookSecurityService) {}

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Delivers an alert webhook for a DOWN or RECOVERY event.
   *
   * Throws one of:
   *  - {@link WebhookTimeoutError}   — request exceeded 10 s
   *  - {@link WebhookResponseError}  — non-2xx HTTP status received
   *  - {@link WebhookNetworkError}   — network-level failure
   *  - {@link SSRFProtectionError}   — URL blocked before request was made
   */
  async sendWebhookAlert(params: SendWebhookAlertParams): Promise<void> {
    await this.securityService.validateWebhookUrl(params.url);

    const payload = this.buildAlertPayload(params);
    const payloadJson = JSON.stringify(payload);
    const event: string = payload.event as string;

    const headers = this.buildHeaders(payloadJson, event, params.secret);
    await this.executeRequest(params.url, headers, payloadJson);
  }

  /**
   * Fires a synthetic test payload to verify a webhook endpoint is reachable.
   * Does NOT create any DB records.
   * Catches delivery errors and returns them as a structured result rather
   * than throwing, so the caller always gets a response object.
   *
   * Re-throws {@link SSRFProtectionError} — that is a configuration error, not
   * a transient delivery failure.
   */
  async sendTestWebhook(url: string, secret?: string): Promise<WebhookTestResult> {
    await this.securityService.validateWebhookUrl(url);

    const now = new Date();
    const payloadJson = JSON.stringify({
      event: 'monitor.test',
      timestamp: now.toISOString(),
      monitor: {
        id: 'test',
        name: 'Test Monitor',
        url: 'https://example.com',
      },
      alert: {
        type: 'TEST',
        triggeredAt: now.toISOString(),
        responseTimeMs: null,
        errorMessage: 'This is a test webhook delivery from Pulse',
        statusCode: null,
      },
    });

    const headers = this.buildHeaders(payloadJson, 'monitor.test', secret);
    const startTime = Date.now();

    try {
      const { httpStatus } = await this.executeRequest(url, headers, payloadJson);
      return { success: true, statusCode: httpStatus, responseTimeMs: Date.now() - startTime };
    } catch (error) {
      const responseTimeMs = Date.now() - startTime;

      if (error instanceof WebhookResponseError) {
        return { success: false, statusCode: error.statusCode, responseTimeMs };
      }
      if (error instanceof WebhookDeliveryError) {
        // Timeout or network error — no HTTP status available
        return { success: false, statusCode: 0, responseTimeMs };
      }
      // SSRFProtectionError and unexpected errors bubble up
      throw error;
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Sends an HTTP POST with the given headers/body.
   * - Enforces a 10 s timeout via AbortController (not a manual setTimeout race).
   * - Follows zero redirects (security best practice).
   * - Accepts only 2xx responses as success.
   *
   * Returns `{ httpStatus, responseTimeMs }` on success.
   * Throws {@link WebhookTimeoutError}, {@link WebhookResponseError}, or
   * {@link WebhookNetworkError} on failure.
   */
  private async executeRequest(
    url: string,
    headers: Record<string, string>,
    body: string,
  ): Promise<{ httpStatus: number; responseTimeMs: number }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
    const startTime = Date.now();
    const truncatedUrl = url.slice(0, 100);

    try {
      let response: Response;

      try {
        response = await fetch(url, {
          method: 'POST',
          headers,
          body,
          signal: controller.signal,
          redirect: 'manual', // treat 3xx as failure — never follow redirects
        });
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          this.logger.warn(`Webhook timeout — url=${truncatedUrl} after=${WEBHOOK_TIMEOUT_MS}ms`);
          throw new WebhookTimeoutError(url, WEBHOOK_TIMEOUT_MS);
        }
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Webhook network error — url=${truncatedUrl} error=${msg}`);
        throw new WebhookNetworkError(msg);
      }

      const responseTimeMs = Date.now() - startTime;
      const { status: httpStatus } = response;

      if (httpStatus >= 200 && httpStatus < 300) {
        this.logger.log(
          `Webhook delivered — url=${truncatedUrl} status=${httpStatus} responseTimeMs=${responseTimeMs}ms`,
        );
        return { httpStatus, responseTimeMs };
      }

      // Non-2xx: capture body for debugging (capped at 500 chars)
      let responseBody = '';
      try {
        const text = await response.text();
        responseBody = text.slice(0, 500);
      } catch {
        // ignore — body read failure should not mask the real error
      }

      this.logger.warn(
        `Webhook non-2xx — url=${truncatedUrl} status=${httpStatus} responseTimeMs=${responseTimeMs}ms`,
      );
      throw new WebhookResponseError(httpStatus, responseBody, url);
    } finally {
      clearTimeout(timer);
    }
  }

  private buildAlertPayload(params: SendWebhookAlertParams): Record<string, unknown> {
    return {
      event: params.type === 'DOWN' ? 'monitor.down' : 'monitor.recovery',
      timestamp: new Date().toISOString(),
      monitor: {
        id: params.monitorId,
        name: params.monitorName,
        url: params.monitorUrl,
      },
      alert: {
        type: params.type,
        triggeredAt: params.triggeredAt.toISOString(),
        responseTimeMs: params.responseTimeMs ?? null,
        errorMessage: params.errorMessage ?? null,
        statusCode: params.statusCode ?? null,
      },
    };
  }

  /**
   * Builds the standard request headers. If `secret` is provided, attaches
   * an HMAC-SHA256 signature using Node's built-in `crypto` module (no
   * external dependency).
   *
   * The secret itself is never logged — only whether it is set.
   */
  private buildHeaders(
    payloadJson: string,
    event: string,
    secret?: string,
  ): Record<string, string> {
    const timestamp = String(Math.floor(Date.now() / 1000));

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'Pulse-Webhook/1.0',
      'X-Pulse-Event': event,
      'X-Pulse-Timestamp': timestamp,
    };

    if (secret) {
      const signature = crypto.createHmac('sha256', secret).update(payloadJson).digest('hex');
      headers['X-Pulse-Signature'] = `sha256=${signature}`;
      this.logger.debug(`HMAC signature attached — event=${event} secretSet=true`);
    }

    return headers;
  }
}
