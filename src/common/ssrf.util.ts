import * as dns from 'node:dns/promises';

/**
 * Returns true if the given IPv4 address belongs to a private / loopback /
 * link-local range that must never be reachable from the public internet.
 */
function isPrivateIP(ip: string): boolean {
  // IPv6 loopback
  if (ip === '::1' || ip === '0:0:0:0:0:0:0:1') return true;

  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return false;

  return (
    parts[0] === 10 || // 10.0.0.0/8
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || // 172.16.0.0/12
    (parts[0] === 192 && parts[1] === 168) || // 192.168.0.0/16
    parts[0] === 127 || // 127.0.0.0/8  loopback
    parts[0] === 0 || // 0.0.0.0/8    current network
    (parts[0] === 169 && parts[1] === 254) // 169.254.0.0/16 link-local
  );
}

/**
 * Resolves the hostname in `urlString` and throws if it maps to a
 * private/internal IP address (SSRF prevention).
 *
 * Throws a plain `Error` so callers in both the API layer and the worker
 * can handle it uniformly.
 */
export async function assertPublicUrl(urlString: string): Promise<void> {
  const { hostname } = new URL(urlString);
  const { address } = await dns.lookup(hostname);

  if (isPrivateIP(address)) {
    throw new Error(`SSRF blocked: "${hostname}" resolves to private/internal address ${address}`);
  }
}
