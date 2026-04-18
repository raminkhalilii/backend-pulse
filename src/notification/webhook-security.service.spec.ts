import * as dns from 'node:dns/promises';
import { SSRFProtectionError } from './errors/webhook.errors';
import { WebhookSecurityService } from './webhook-security.service';

// Mock the entire dns/promises module so lookup is a configurable Jest mock
jest.mock('node:dns/promises');

// Helper: mock dns.lookup to return a specific IP address
function mockDns(address: string) {
  (dns.lookup as jest.Mock).mockResolvedValue({ address, family: 4 });
}

describe('WebhookSecurityService', () => {
  let service: WebhookSecurityService;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    service = new WebhookSecurityService();
    jest.resetAllMocks();
    // Default to development so HTTPS-only check doesn't interfere unless explicitly tested
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  // ── HTTPS enforcement ──────────────────────────────────────────────────────

  describe('HTTPS enforcement', () => {
    it('rejects an HTTP URL in production', async () => {
      process.env.NODE_ENV = 'production';
      mockDns('93.184.216.34');

      await expect(service.validateWebhookUrl('http://example.com/hook')).rejects.toThrow(
        SSRFProtectionError,
      );
    });

    it('allows an HTTP URL in development', async () => {
      process.env.NODE_ENV = 'development';
      mockDns('93.184.216.34');

      await expect(service.validateWebhookUrl('http://example.com/hook')).resolves.toBeUndefined();
    });

    it('accepts an HTTPS URL in production', async () => {
      process.env.NODE_ENV = 'production';
      mockDns('93.184.216.34');

      await expect(service.validateWebhookUrl('https://example.com/hook')).resolves.toBeUndefined();
    });
  });

  // ── Embedded credentials ───────────────────────────────────────────────────

  describe('embedded credentials', () => {
    it('rejects URLs with a username', async () => {
      mockDns('93.184.216.34');

      await expect(service.validateWebhookUrl('https://user@example.com/hook')).rejects.toThrow(
        SSRFProtectionError,
      );
    });

    it('rejects URLs with username:password', async () => {
      mockDns('93.184.216.34');

      await expect(
        service.validateWebhookUrl('https://user:pass@example.com/hook'),
      ).rejects.toThrow(SSRFProtectionError);
    });
  });

  // ── Localhost / well-known blocked hostnames ───────────────────────────────

  describe('blocked hostnames', () => {
    it('rejects "localhost"', async () => {
      await expect(service.validateWebhookUrl('https://localhost/hook')).rejects.toThrow(
        SSRFProtectionError,
      );
    });

    it('rejects "0.0.0.0"', async () => {
      await expect(service.validateWebhookUrl('https://0.0.0.0/hook')).rejects.toThrow(
        SSRFProtectionError,
      );
    });

    it('rejects "::1" as hostname', async () => {
      await expect(service.validateWebhookUrl('https://[::1]/hook')).rejects.toThrow(
        SSRFProtectionError,
      );
    });
  });

  // ── Private IP ranges (DNS-resolved) ──────────────────────────────────────

  describe('private IP ranges', () => {
    const privateCases: Array<[string, string]> = [
      ['10.0.0.0/8', '10.0.0.1'],
      ['10.255.255.255', '10.255.255.255'],
      ['172.16.0.0/12 (start)', '172.16.0.1'],
      ['172.31.255.255', '172.31.255.255'],
      ['192.168.0.0/16', '192.168.1.100'],
      ['127.0.0.0/8 loopback', '127.0.0.1'],
      ['127.255.255.255', '127.255.255.255'],
      ['0.0.0.0/8 current network', '0.0.0.1'],
      ['169.254.0.0/16 link-local', '169.254.169.254'], // AWS metadata
    ];

    it.each(privateCases)('rejects %s (resolves to %s)', async (_, ip) => {
      mockDns(ip);

      await expect(
        service.validateWebhookUrl('https://attacker-controlled.com/hook'),
      ).rejects.toThrow(SSRFProtectionError);
    });

    it('rejects IPv6 loopback (::1)', async () => {
      (dns.lookup as jest.Mock).mockResolvedValue({ address: '::1', family: 6 });

      await expect(
        service.validateWebhookUrl('https://attacker-controlled.com/hook'),
      ).rejects.toThrow(SSRFProtectionError);
    });

    it('rejects IPv6 unique-local fc00::/7', async () => {
      (dns.lookup as jest.Mock).mockResolvedValue({ address: 'fc00::1', family: 6 });

      await expect(
        service.validateWebhookUrl('https://attacker-controlled.com/hook'),
      ).rejects.toThrow(SSRFProtectionError);
    });

    it('rejects IPv6 unique-local fd00::/8', async () => {
      (dns.lookup as jest.Mock).mockResolvedValue({ address: 'fd00::1', family: 6 });

      await expect(
        service.validateWebhookUrl('https://attacker-controlled.com/hook'),
      ).rejects.toThrow(SSRFProtectionError);
    });
  });

  // ── Public IPs (should pass) ───────────────────────────────────────────────

  describe('valid public URLs', () => {
    const publicCases: Array<[string, string]> = [
      ['example.com', '93.184.216.34'],
      ['8.8.8.8', '8.8.8.8'],
      ['1.1.1.1', '1.1.1.1'],
      ['172.15.255.255 (just below private range)', '172.15.255.255'],
      ['172.32.0.0 (just above private range)', '172.32.0.0'],
      ['192.169.0.0 (just above 192.168)', '192.169.0.0'],
    ];

    it.each(publicCases)('accepts %s (resolves to %s)', async (_, ip) => {
      mockDns(ip);

      await expect(
        service.validateWebhookUrl(`https://some-host.com/webhook`),
      ).resolves.toBeUndefined();
    });
  });

  // ── DNS failure ────────────────────────────────────────────────────────────

  it('throws SSRFProtectionError when DNS lookup fails', async () => {
    (dns.lookup as jest.Mock).mockRejectedValue(new Error('ENOTFOUND'));

    await expect(service.validateWebhookUrl('https://does-not-exist.invalid/hook')).rejects.toThrow(
      SSRFProtectionError,
    );
  });

  // ── Malformed URL ──────────────────────────────────────────────────────────

  it('throws SSRFProtectionError for a malformed URL', async () => {
    await expect(service.validateWebhookUrl('not a url')).rejects.toThrow(SSRFProtectionError);
  });
});
