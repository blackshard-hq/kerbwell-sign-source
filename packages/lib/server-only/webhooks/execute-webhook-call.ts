import type { Prisma } from '@prisma/client';

import { fetchWithTimeout } from '../../utils/timeout';
import { assertNotPrivateUrl } from './assert-webhook-url';
import { buildWebhookHeaders } from './kerbwell-signature';

const WEBHOOK_TIMEOUT_MS = 10_000;

export type WebhookCallResult = {
  success: boolean;
  responseCode: number;
  responseBody: Prisma.InputJsonValue | Prisma.JsonNullValueInput;
  responseHeaders: Record<string, string>;
};

const parseBody = (text: string): Prisma.InputJsonValue => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

export const executeWebhookCall = async (options: {
  url: string;
  body: unknown;
  secret: string | null;
}): Promise<WebhookCallResult> => {
  const { url, body, secret } = options;

  try {
    await assertNotPrivateUrl(url);

    // Signed over the exact bytes sent, so the receiver can verify the raw body.
    const payload = JSON.stringify(body);

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      body: payload,
      redirect: 'manual',
      timeoutMs: WEBHOOK_TIMEOUT_MS,
      headers: buildWebhookHeaders({ secret, body: payload }),
    });

    const text = await response.text();

    return {
      success: response.ok,
      responseCode: response.status,
      responseBody: parseBody(text),
      responseHeaders: Object.fromEntries(response.headers.entries()),
    };
  } catch (err) {
    return {
      success: false,
      responseCode: 0,
      responseBody: err instanceof Error ? err.message : 'Unknown error',
      responseHeaders: {},
    };
  }
};
