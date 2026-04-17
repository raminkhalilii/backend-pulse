import { Injectable, Logger } from '@nestjs/common';
import { SlackDeliveryError, SlackInvalidWebhookError } from './errors/platform.errors';

const SLACK_TIMEOUT_MS = 10_000;
const SLACK_WEBHOOK_PREFIX = 'https://hooks.slack.com/';

// ── Parameter interface ────────────────────────────────────────────────────────

export interface SendSlackAlertParams {
  webhookUrl: string;
  monitorName: string;
  monitorUrl: string;
  type: 'DOWN' | 'RECOVERY';
  triggeredAt: Date;
  responseTimeMs?: number;
  errorMessage?: string;
  statusCode?: number;
  dashboardUrl: string;
}

// ── Block Kit type definitions ─────────────────────────────────────────────────

interface PlainTextField {
  type: 'plain_text';
  text: string;
  emoji: boolean;
}

interface MrkdwnField {
  type: 'mrkdwn';
  text: string;
}

interface MrkdwnContextElement {
  type: 'mrkdwn';
  text: string;
}

interface SlackButton {
  type: 'button';
  text: PlainTextField;
  url: string;
  style: 'danger' | 'primary';
}

type SlackBlock =
  | { type: 'header'; text: PlainTextField }
  | { type: 'section'; fields: MrkdwnField[] }
  | { type: 'actions'; elements: SlackButton[] }
  | { type: 'context'; elements: MrkdwnContextElement[] };

interface SlackPayload {
  text: string;
  blocks: SlackBlock[];
}

// ── Service ────────────────────────────────────────────────────────────────────

@Injectable()
export class SlackService {
  private readonly logger = new Logger(SlackService.name);

  /**
   * Sends a rich Slack Block Kit alert message to an Incoming Webhook URL.
   *
   * Throws:
   *  - {@link SlackInvalidWebhookError}  — URL does not start with https://hooks.slack.com/
   *  - {@link SlackDeliveryError}        — non-2xx response, timeout, or network failure
   */
  async sendSlackAlert(params: SendSlackAlertParams): Promise<void> {
    // c) URL validation — must be a Slack Incoming Webhook before any request
    if (!params.webhookUrl.startsWith(SLACK_WEBHOOK_PREFIX)) {
      throw new SlackInvalidWebhookError(params.webhookUrl);
    }

    const payload = this.buildPayload(params);
    const body = JSON.stringify(payload);

    const response = await this.executeRequest(params.webhookUrl, body);

    if (response.status < 200 || response.status >= 300) {
      let responseBody = '';
      try {
        const text = await response.text();
        responseBody = text.slice(0, 500);
      } catch {
        // ignore body read failure — don't mask the real error
      }
      this.logger.warn(
        `Slack non-2xx — url=${params.webhookUrl.slice(0, 60)} status=${response.status}`,
      );
      throw new SlackDeliveryError(
        `Slack returned ${response.status}: ${responseBody}`,
        response.status,
      );
    }

    this.logger.log(
      `Slack alert delivered — url=${params.webhookUrl.slice(0, 60)} type=${params.type} status=${response.status}`,
    );
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Executes the HTTP POST with a 10 s AbortController timeout.
   * Returns the raw Response so the caller decides how to handle status codes.
   *
   * Throws {@link SlackDeliveryError} on timeout or network failure.
   */
  private async executeRequest(url: string, body: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SLACK_TIMEOUT_MS);
    const truncatedUrl = url.slice(0, 60);

    try {
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: controller.signal,
        });
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          this.logger.warn(
            `Slack webhook timeout — url=${truncatedUrl} after=${SLACK_TIMEOUT_MS}ms`,
          );
          throw new SlackDeliveryError(`Slack webhook timed out after ${SLACK_TIMEOUT_MS}ms`);
        }
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Slack network error — url=${truncatedUrl} error=${msg}`);
        throw new SlackDeliveryError(`Network error delivering to Slack: ${msg}`);
      }
      return response;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * a) Builds the Slack Block Kit JSON payload.
   *
   * Structure for both DOWN and RECOVERY:
   *   1. header block     — alert type heading
   *   2. section (4 fields) — monitor link, status, time, error/response time
   *   3. section (2 fields) — status code, response time
   *   4. actions block    — "View Dashboard" button (danger for DOWN, primary for RECOVERY)
   *   5. context block    — Pulse branding + manage-alerts link
   */
  private buildPayload(params: SendSlackAlertParams): SlackPayload {
    const isDown = params.type === 'DOWN';
    const formattedTime = formatUtcDate(params.triggeredAt);
    const appUrl = new URL(params.dashboardUrl).origin;

    const headerText = isDown ? '🔴 Monitor Down Alert' : '🟢 Monitor Recovered';
    const statusText = isDown ? '🔴 DOWN' : '🟢 UP';
    const timeLabel = isDown ? '*Detected at:*' : '*Recovered at:*';
    const buttonStyle: 'danger' | 'primary' = isDown ? 'danger' : 'primary';

    // Section 1: four key facts
    // For DOWN: error message. For RECOVERY: response time (proves the site is back).
    const section1Fields: MrkdwnField[] = [
      {
        type: 'mrkdwn',
        text: `*Monitor:*\n<${params.monitorUrl}|${params.monitorName}>`,
      },
      {
        type: 'mrkdwn',
        text: `*Status:*\n${statusText}`,
      },
      {
        type: 'mrkdwn',
        text: `${timeLabel}\n${formattedTime}`,
      },
      isDown
        ? {
            type: 'mrkdwn',
            text: `*Error:*\n${params.errorMessage ?? 'No response'}`,
          }
        : {
            type: 'mrkdwn',
            text: `*Response Time:*\n${
              params.responseTimeMs == null ? 'N/A' : `${params.responseTimeMs}ms`
            }`,
          },
    ];

    // Section 2: technical details
    const section2Fields: MrkdwnField[] = [
      {
        type: 'mrkdwn',
        text: `*Status Code:*\n${params.statusCode ?? 'N/A'}`,
      },
      {
        type: 'mrkdwn',
        text: `*Response Time:*\n${
          params.responseTimeMs == null ? 'Timeout' : `${params.responseTimeMs}ms`
        }`,
      },
    ];

    return {
      text: isDown ? `🔴 ${params.monitorName} is DOWN` : `🟢 ${params.monitorName} is back UP`,
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: headerText, emoji: true },
        },
        {
          type: 'section',
          fields: section1Fields,
        },
        {
          type: 'section',
          fields: section2Fields,
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'View Dashboard', emoji: false },
              url: params.dashboardUrl,
              style: buttonStyle,
            },
          ],
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `Sent by <${appUrl}|Pulse> · <${params.dashboardUrl}/alerts|Manage alerts>`,
            },
          ],
        },
      ],
    };
  }
}

// ── Utilities ──────────────────────────────────────────────────────────────────

/** Formats a Date as "April 17, 2026 at 12:00 UTC" */
function formatUtcDate(date: Date): string {
  return (
    date.toLocaleString('en-US', {
      timeZone: 'UTC',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }) + ' UTC'
  );
}
