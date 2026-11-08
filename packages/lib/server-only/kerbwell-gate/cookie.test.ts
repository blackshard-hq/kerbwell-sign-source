import { describe, expect, it } from 'vitest';

import { clearKerbwellGateCookie, readKerbwellGateCookie, serializeKerbwellGateCookie } from './cookie';

const HANDLE = 'A'.repeat(43);

describe('gate cookie', () => {
  it('is __Host-, HttpOnly, Secure, SameSite=Lax, Path=/ and 30 minutes', () => {
    const cookie = serializeKerbwellGateCookie(HANDLE);
    expect(cookie.startsWith(`__Host-kw_gate=${HANDLE}`)).toBe(true);
    for (const part of ['Path=/', 'Max-Age=1800', 'HttpOnly', 'Secure', 'SameSite=Lax']) {
      expect(cookie).toContain(part);
    }
    expect(cookie).not.toContain('Domain=');
  });

  it('clears with Max-Age=0', () => {
    expect(clearKerbwellGateCookie()).toContain('Max-Age=0');
  });

  it('reads only a well-formed handle', () => {
    expect(readKerbwellGateCookie(`a=b; __Host-kw_gate=${HANDLE}; c=d`)).toBe(HANDLE);
    expect(readKerbwellGateCookie('__Host-kw_gate=short')).toBeNull();
    expect(readKerbwellGateCookie(`kw_gate=${HANDLE}`)).toBeNull();
    expect(readKerbwellGateCookie(null)).toBeNull();
  });
});
