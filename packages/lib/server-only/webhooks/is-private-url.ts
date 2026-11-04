import { z } from 'zod';

const ZIpSchema = z.string().ip();

/**
 * Synchronously check whether a URL's host is a known private/loopback address
 * (localhost, RFC 1918, link-local, loopback, etc.), regardless of protocol.
 *
 * Best-effort and non-exhaustive: unrecognised or unparseable hosts return
 * `false` (fail open). See `assertNotPrivateUrl` for the full SSRF caveats.
 */
export const isPrivateUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    // Strip IPv6 brackets.
    const bare = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;
    const normalizedHost = bare.replace(/\.+$/, '');

    if (normalizedHost === 'localhost') {
      return true;
    }

    const parsedIp = ZIpSchema.safeParse(normalizedHost);

    if (!parsedIp.success) {
      return false;
    }

    if (normalizedHost === '::1' || normalizedHost === '::') {
      return true;
    }

    if (normalizedHost === '0.0.0.0') {
      return true;
    }

    if (normalizedHost.startsWith('127.')) {
      return true;
    }

    if (normalizedHost.startsWith('10.')) {
      return true;
    }

    if (normalizedHost.startsWith('192.168.')) {
      return true;
    }

    if (normalizedHost.startsWith('169.254.')) {
      return true;
    }

    if (normalizedHost.startsWith('fe80:')) {
      return true;
    }

    if (normalizedHost.startsWith('fc') || normalizedHost.startsWith('fd')) {
      return true;
    }

    // 172.16.0.0/12
    if (normalizedHost.startsWith('172.')) {
      const second = parseInt(normalizedHost.split('.')[1], 10);

      if (second >= 16 && second <= 31) {
        return true;
      }
    }

    // IPv4-mapped IPv6, in EITHER textual form. Critical: the WHATWG URL parser
    // normalises [::ffff:127.0.0.1] to the compressed HEX form ::ffff:7f00:1, so a
    // dotted-only regex missed it - letting a webhook URL like
    // http://[::ffff:169.254.169.254]/ or http://[::ffff:127.0.0.1]:6379/ bypass
    // every private-range check and reach loopback / RFC1918 / link-local / cloud
    // metadata. Handle both the dotted and the hex serialisation.
    const v4MappedDotted = normalizedHost.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);

    if (v4MappedDotted) {
      return isPrivateUrl(`http://${v4MappedDotted[1]}`);
    }

    const v4MappedHex = normalizedHost.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);

    if (v4MappedHex) {
      const hi = parseInt(v4MappedHex[1], 16);
      const lo = parseInt(v4MappedHex[2], 16);
      const ipv4 = [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff].join('.');

      return isPrivateUrl(`http://${ipv4}`);
    }

    return false;
  } catch {
    return false;
  }
};
