import { WebhookDeliveryError } from './webhook.errors';

// ── Slack errors ───────────────────────────────────────────────────────────────

/**
 * Base error for all Slack delivery failures.
 * An optional `statusCode` is included when the Slack API returned an HTTP
 * response (as opposed to a timeout or network error).
 */
export class SlackDeliveryError extends WebhookDeliveryError {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'SlackDeliveryError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown before any HTTP request is made when the configured webhook URL
 * is not a Slack Incoming Webhook URL.
 * This prevents silent misconfiguration (e.g. a Discord URL in a Slack channel).
 */
export class SlackInvalidWebhookError extends SlackDeliveryError {
  constructor(url: string) {
    super(
      `Invalid Slack webhook URL — must start with https://hooks.slack.com/: ${url.slice(0, 60)}`,
    );
    this.name = 'SlackInvalidWebhookError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ── Discord errors ─────────────────────────────────────────────────────────────

/**
 * Base error for all Discord delivery failures.
 * An optional `statusCode` is included when the Discord API returned an HTTP
 * response (as opposed to a timeout or network error).
 */
export class DiscordDeliveryError extends WebhookDeliveryError {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'DiscordDeliveryError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown before any HTTP request is made when the configured webhook URL
 * is not a Discord webhook URL.
 * This prevents silent misconfiguration (e.g. a Slack URL in a Discord channel).
 */
export class DiscordInvalidWebhookError extends DiscordDeliveryError {
  constructor(url: string) {
    super(
      `Invalid Discord webhook URL — must start with https://discord.com/api/webhooks/ or ` +
        `https://discordapp.com/api/webhooks/: ${url.slice(0, 60)}`,
    );
    this.name = 'DiscordInvalidWebhookError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
