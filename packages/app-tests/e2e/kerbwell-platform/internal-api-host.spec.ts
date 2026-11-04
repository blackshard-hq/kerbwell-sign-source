/**
 * Kerbwell: the document API answers only on the internal host.
 *
 * The server under test runs with NEXT_PRIVATE_INTERNAL_API_HOSTS naming one host. The same
 * server is reached twice: KERBWELL_E2E_INTERNAL_URL uses the listed host, and
 * KERBWELL_E2E_PUBLIC_URL (default NEXT_PUBLIC_WEBAPP_URL) uses any other name for it.
 *
 *   NEXT_PRIVATE_INTERNAL_API_HOSTS=127.0.0.1 (server)
 *   KERBWELL_E2E_INTERNAL_URL=http://127.0.0.1:3000 KERBWELL_E2E_PUBLIC_URL=http://localhost:3000
 *
 * Skipped when KERBWELL_E2E_INTERNAL_URL is unset (the upstream suite runs with the lock off).
 */
import { NEXT_PUBLIC_WEBAPP_URL } from '@documenso/lib/constants/app';
import { expect, test } from '@playwright/test';

import { apiCreateTestContext } from '../fixtures/api-seeds';

const INTERNAL_URL = process.env.KERBWELL_E2E_INTERNAL_URL;
const PUBLIC_URL = process.env.KERBWELL_E2E_PUBLIC_URL || NEXT_PUBLIC_WEBAPP_URL();

test.describe('kerbwell internal API host', () => {
  test.skip(!INTERNAL_URL, 'KERBWELL_E2E_INTERNAL_URL is not set');

  test('a public-host GET to /api/v2/envelope returns 404, even with a valid token', async ({ request }) => {
    const { token } = await apiCreateTestContext('kerbwell-host-lock');

    const res = await request.get(`${PUBLIC_URL}/api/v2/envelope`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status()).toBe(404);

    for (const path of ['/api/v1/documents', '/api/v2-beta/envelope', '/api/v2/openapi.json']) {
      const other = await request.get(`${PUBLIC_URL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
      expect(other.status(), path).toBe(404);
    }
  });

  test('an internal-host request with a valid token returns 200', async ({ request }) => {
    const { token } = await apiCreateTestContext('kerbwell-host-lock');

    const res = await request.get(`${INTERNAL_URL}/api/v2/envelope`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('the health check and the signing pages stay public', async ({ request }) => {
    const health = await request.get(`${PUBLIC_URL}/api/health`);
    expect(health.status()).toBe(200);

    const signin = await request.get(`${PUBLIC_URL}/signin`);
    expect(signin.status()).toBe(200);
  });
});
