import { Injectable, Logger } from '@nestjs/common';
import * as dns from 'node:dns/promises';
import { SSRFProtectionError } from './errors/webhook.errors';

/**
 * Returns true when the IPv4/IPv6 address belongs to a range that must
 * never be reachable from the public internet.
 *
 * Ranges blocked:
 *   10.0.0.0/8          — private
 *   172.16.0.0/12       — private
 *   192.168.0.0/16      — private
 *   127.0.0.0/8         — loopback
 *   0.0.0.0/8           — current network
 *   169.254.0.0/16      — link-local (APIPA / AWS metadata)
 *   ::1                  — IPv6 loopback
 *   fc00::/7            — IPv6 unique local (fc00:: and fd00::)
 */
function isPrivateIP(ip: string): boolean {
  // IPv6 loopback
  if (ip === '::1' || ip === '0:0:0:0:0:0:0:1') return true;

  // IPv6 unique local (fc00::/7 covers fc** and fd**)
  if (/^f[cd]/i.test(ip)) return true;

  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return false;

  const [a, b] = parts;

  return (
    a === 10 || // 10.0.0.0/8
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168) || // 192.168.0.0/16
    a === 127 || // 127.0.0.0/8  loopback
    a === 0 || // 0.0.0.0/8    current network
    (a === 169 && b === 254) // 169.254.0.0/16 link-local
  );
}

/** Hostnames that are always blocked regardless of DNS resolution. */
const BLOCKED_HOSTNAMES = new Set(['localhost', '0.0.0.0', '::1', 'ip6-localhost', 'ip6-loopback']);

@Injectable()
export class WebhookSecurityService {
  private readonly logger = new Logger(WebhookSecurityService.name);

  /**
   * Validates that the given URL is safe to use as a webhook target.
   *
   * Checks (in order):
   *  1. URL must be parseable
   *  2. HTTPS required in production (NODE_ENV === 'production')
   *  3. No embedded credentials (user:pass@host)
   *  4. Hostname must not be a known-private alias (localhost, 0.0.0.0, etc.)
   *  5. DNS resolution must succeed and the resolved IP must be public
   *
   * Throws {@link SSRFProtectionError} on any violation so the caller never
   * needs to inspect multiple exception types.
   */
  async validateWebhookUrl(urlString: string): Promise<void> {
    // ── 1. Parse ──────────────────────────────────────────────────────────────
    let parsed: URL;
    try {
      parsed = new URL(urlString);
    } catch {
      throw new SSRFProtectionError(`Malformed URL: "${urlString.slice(0, 100)}"`);
    }

    // ── 2. HTTPS only in production ───────────────────────────────────────────
    if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
      throw new SSRFProtectionError(
        `Only HTTPS webhook URLs are allowed in production (got "${parsed.protocol}")`,
      );
    }

    // ── 3. No embedded credentials ────────────────────────────────────────────
    if (parsed.username || parsed.password) {
      throw new SSRFProtectionError(
        'Webhook URL must not contain embedded credentials (user:pass@host)',
      );
    }

    // ── 4. Blocked hostnames ──────────────────────────────────────────────────
    const hostname = parsed.hostname.toLowerCase();
    if (BLOCKED_HOSTNAMES.has(hostname)) {
      throw new SSRFProtectionError(`Hostname "${parsed.hostname}" is not allowed`);
    }

    // ── 5. DNS resolution + private-IP check ──────────────────────────────────
    // Resolve the hostname to its IP address so that domains that alias private
    // addresses (e.g. attacker.com → 192.168.1.1) are also blocked.
    let resolvedAddress: string;
    try {
      const result = await dns.lookup(hostname);
      resolvedAddress = result.address;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SSRFProtectionError(`DNS lookup failed for "${parsed.hostname}": ${message}`);
    }

    if (isPrivateIP(resolvedAddress)) {
      throw new SSRFProtectionError(
        `"${parsed.hostname}" resolves to a private/internal address (${resolvedAddress})`,
      );
    }

    this.logger.debug(`SSRF check passed — host=${parsed.hostname} resolvedTo=${resolvedAddress}`);
  }
}
