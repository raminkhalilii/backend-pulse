/**
 * Base class for all webhook delivery errors.
 * Extend this to create specific error types that the consumer and service
 * can catch and handle distinctly from generic runtime errors.
 */
export class WebhookDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookDeliveryError';
    // Maintains proper prototype chain in transpiled ES5
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * The target webhook URL did not respond within the configured timeout.
 */
export class WebhookTimeoutError extends WebhookDeliveryError {
  constructor(
    public readonly url: string,
    public readonly timeoutMs: number,
  ) {
    super(`Webhook timed out after ${timeoutMs}ms — url=${url.slice(0, 100)}`);
    this.name = 'WebhookTimeoutError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * The target webhook URL responded with a non-2xx HTTP status code.
 * The response body (capped at 500 chars) is included for debugging.
 */
export class WebhookResponseError extends WebhookDeliveryError {
  constructor(
    public readonly statusCode: number,
    public readonly responseBody: string,
    url: string,
  ) {
    super(
      `Webhook returned ${statusCode} from ${url.slice(0, 100)}: ${responseBody.slice(0, 500)}`,
    );
    this.name = 'WebhookResponseError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * A network-level failure occurred before a response could be received
 * (e.g. DNS failure, TCP connection refused, TLS handshake error).
 */
export class WebhookNetworkError extends WebhookDeliveryError {
  constructor(message: string) {
    super(`Webhook network error: ${message}`);
    this.name = 'WebhookNetworkError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * The webhook URL was rejected by SSRF protection before any HTTP request
 * was made (private IP, HTTP scheme in production, embedded credentials, etc.).
 */
export class SSRFProtectionError extends WebhookDeliveryError {
  constructor(reason: string) {
    super(`SSRF protection blocked webhook request: ${reason}`);
    this.name = 'SSRFProtectionError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
