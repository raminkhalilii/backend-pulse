import { Injectable, Logger } from '@nestjs/common';
import { DiscordDeliveryError, DiscordInvalidWebhookError } from './errors/platform.errors';

const DISCORD_TIMEOUT_MS = 10_000;
const DISCORD_WEBHOOK_PREFIXES = [
  'https://discord.com/api/webhooks/',
  'https://discordapp.com/api/webhooks/',
];

/** Red color for DOWN alerts (0xE74C3C = Alizarin). */
const DISCORD_COLOR_DOWN = 15_158_332;
/** Green color for RECOVERY alerts (0x2ECC71 = Emerald). */
const DISCORD_COLOR_RECOVERY = 3_066_993;

// ── Parameter interface ────────────────────────────────────────────────────────

export interface SendDiscordAlertParams {
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

// ── Discord payload type definitions ──────────────────────────────────────────

interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

interface DiscordEmbed {
  title: string;
  description: string;
  color: number;
  url: string;
  fields: DiscordEmbedField[];
  footer: {
    text: string;
    icon_url: string;
  };
  timestamp: string;
}

interface DiscordActionButton {
  type: 2; // BUTTON component type
  style: 5; // LINK style
  label: string;
  url: string;
}

interface DiscordActionRow {
  type: 1; // ACTION_ROW component type
  components: DiscordActionButton[];
}

interface DiscordPayload {
  username: string;
  avatar_url: string;
  embeds: DiscordEmbed[];
  components: DiscordActionRow[];
}

// ── Service ────────────────────────────────────────────────────────────────────

@Injectable()
export class DiscordService {
  private readonly logger = new Logger(DiscordService.name);

  /**
   * Sends a rich Discord Embed alert message to a webhook URL.
   *
   * Handles Discord's 429 rate-limit: reads the Retry-After header and retries
   * the request exactly once before throwing.
   *
   * Throws:
   *  - {@link DiscordInvalidWebhookError} — URL does not match discord.com or discordapp.com webhooks
   *  - {@link DiscordDeliveryError}        — non-2xx response (after retry if 429), timeout, or network failure
   */
  async sendDiscordAlert(params: SendDiscordAlertParams): Promise<void> {
    // c) URL validation — must be a Discord webhook before any request
    if (!DISCORD_WEBHOOK_PREFIXES.some((prefix) => params.webhookUrl.startsWith(prefix))) {
      throw new DiscordInvalidWebhookError(params.webhookUrl);
    }

    const payload = this.buildPayload(params);
    const body = JSON.stringify(payload);
    const truncatedUrl = params.webhookUrl.slice(0, 60);

    let response = await this.executeRequest(params.webhookUrl, body);

    // b) Handle Discord rate limiting — read Retry-After, wait, then retry once
    if (response.status === 429) {
      const retryAfterHeader = response.headers.get('Retry-After');
      const retryAfterSec = retryAfterHeader ? Number.parseFloat(retryAfterHeader) : 1;

      this.logger.warn(`Discord rate limited — url=${truncatedUrl} retryAfter=${retryAfterSec}s`);

      await new Promise<void>((resolve) => setTimeout(resolve, retryAfterSec * 1000));

      // Single retry after the wait
      response = await this.executeRequest(params.webhookUrl, body);
    }

    if (response.status < 200 || response.status >= 300) {
      let responseBody = '';
      try {
        const text = await response.text();
        responseBody = text.slice(0, 500);
      } catch {
        // ignore body read failure — don't mask the real error
      }
      this.logger.warn(`Discord non-2xx — url=${truncatedUrl} status=${response.status}`);
      throw new DiscordDeliveryError(
        `Discord returned ${response.status}: ${responseBody}`,
        response.status,
      );
    }

    this.logger.log(
      `Discord alert delivered — url=${truncatedUrl} type=${params.type} status=${response.status}`,
    );
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Executes the HTTP POST with a 10 s AbortController timeout.
   * Returns the raw Response so the caller can inspect the status code,
   * including 429, before deciding whether to retry.
   *
   * Throws {@link DiscordDeliveryError} on timeout or network failure.
   */
  private async executeRequest(url: string, body: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DISCORD_TIMEOUT_MS);
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
            `Discord webhook timeout — url=${truncatedUrl} after=${DISCORD_TIMEOUT_MS}ms`,
          );
          throw new DiscordDeliveryError(`Discord webhook timed out after ${DISCORD_TIMEOUT_MS}ms`);
        }
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Discord network error — url=${truncatedUrl} error=${msg}`);
        throw new DiscordDeliveryError(`Network error delivering to Discord: ${msg}`);
      }
      return response;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * a) Builds the Discord Webhook + Embed JSON payload.
   *
   * The embed structure differs between DOWN and RECOVERY:
   *  - DOWN:     red color, "gone offline" description, error in fields
   *  - RECOVERY: green color, "responding normally" description, response time prominently
   *
   * A link button component is appended to every message so users can
   * navigate to the Pulse dashboard in one click.
   */
  private buildPayload(params: SendDiscordAlertParams): DiscordPayload {
    const isDown = params.type === 'DOWN';
    const appUrl = new URL(params.dashboardUrl).origin;

    const title = isDown
      ? `🔴 ${params.monitorName} is DOWN`
      : `🟢 ${params.monitorName} is back UP`;

    const description = isDown
      ? 'Your monitor has gone offline and requires attention.'
      : 'Your monitor has recovered and is responding normally.';

    const color = isDown ? DISCORD_COLOR_DOWN : DISCORD_COLOR_RECOVERY;

    const fields: DiscordEmbedField[] = [
      {
        name: '🌐 URL',
        value: params.monitorUrl,
        inline: true,
      },
      {
        name: '📊 Status Code',
        value: params.statusCode == null ? 'No Response' : String(params.statusCode),
        inline: true,
      },
      {
        name: '⏱ Response Time',
        value: params.responseTimeMs == null ? 'Timeout' : `${params.responseTimeMs}ms`,
        inline: true,
      },
    ];

    if (isDown) {
      fields.push({
        name: '❌ Error',
        value: params.errorMessage ?? 'Connection refused',
        inline: false,
      });
    }

    fields.push({
      name: '🕐 Detected At',
      value: params.triggeredAt.toISOString(),
      inline: false,
    });

    return {
      username: 'Pulse Alerts',
      avatar_url: `${appUrl}/icon.png`,
      embeds: [
        {
          title,
          description,
          color,
          url: params.monitorUrl,
          fields,
          footer: {
            text: `Pulse Uptime Monitoring · ${new URL(appUrl).hostname}`,
            icon_url: `${appUrl}/icon.png`,
          },
          timestamp: params.triggeredAt.toISOString(),
        },
      ],
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 5,
              label: 'View Dashboard',
              url: params.dashboardUrl,
            },
          ],
        },
      ],
    };
  }
}
