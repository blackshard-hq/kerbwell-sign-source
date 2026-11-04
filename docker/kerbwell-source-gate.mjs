#!/usr/bin/env node
// kerbwell-source-gate.mjs: the image build refuses to finish without public corresponding
// source (AGPL-3.0 section 13).
//
// docker/Dockerfile runs this in its `source-gate` stage, and the shipped image depends on that
// stage. The build fails unless KERBWELL_SOURCE_URL is a snapshot tag of the public mirror
// (https://github.com/blackshard-hq/kerbwell-sign-source/tree/src-<12 hex>) and that URL answers
// 200 to an anonymous request: no token, no cookie, not a sign-in page. An empty value, a
// commit of the private repository, any other repository and a tag that was never published
// all stop the build. docker/kerbwell-source.sh publishes the tag before the build.
//
//   node kerbwell-source-gate.mjs URL
//
// Environment: KERBWELL_SOURCE_ATTEMPTS (default 6, 5 s apart) for GitHub's short publish lag.
// Exit codes: 0 reachable, 1 refused.

export const MIRROR_URL_PATTERN =
  /^https:\/\/github\.com\/blackshard-hq\/kerbwell-sign-source\/tree\/src-[0-9a-f]{12}$/;

const MAX_REDIRECTS = 3;
const SIGN_IN_PATH = /^\/(login|session|sessions)(\/|\?|$)/;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// One anonymous GET, following at most three redirects by hand so every hop is checked.
const probe = async (url, fetchImpl) => {
  let current = new URL(url);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetchImpl(current.href, {
      method: 'GET',
      redirect: 'manual',
      credentials: 'omit',
      headers: { 'user-agent': 'kerbwell-source-gate' },
      signal: AbortSignal.timeout(20_000),
    });
    await response.body?.cancel?.().catch(() => {});

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        return { ok: false, reason: `answered ${response.status} with no location`, final: true };
      }
      const next = new URL(location, current);
      if (next.protocol !== 'https:' || next.hostname !== 'github.com') {
        return { ok: false, reason: `redirect left github.com (${next.origin})`, final: true };
      }
      if (SIGN_IN_PATH.test(next.pathname)) {
        return { ok: false, reason: 'redirects to a sign-in page', final: true };
      }
      current = next;
      continue;
    }

    if (response.status === 200) {
      return { ok: true };
    }
    return { ok: false, reason: `answered ${response.status}` };
  }
  return { ok: false, reason: `more than ${MAX_REDIRECTS} redirects`, final: true };
};

export const checkSourceUrl = async (
  rawUrl,
  {
    fetch: fetchImpl = globalThis.fetch,
    attempts = Number(process.env.KERBWELL_SOURCE_ATTEMPTS || 6),
    delayMs = 5000,
    log = (line) => console.error(`[kerbwell-source-gate] ${line}`),
  } = {},
) => {
  const url = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (url === '') {
    return {
      ok: false,
      reason:
        'KERBWELL_SOURCE_URL is empty. Publish the source first: docker/kerbwell-source.sh release HEAD, then pass --build-arg KERBWELL_SOURCE_URL="$(docker/kerbwell-source.sh url HEAD)"',
    };
  }
  if (!MIRROR_URL_PATTERN.test(url)) {
    return {
      ok: false,
      reason: `${url} is not a public mirror snapshot (https://github.com/blackshard-hq/kerbwell-sign-source/tree/src-<12 hex>)`,
    };
  }

  let last = { ok: false, reason: 'not tried' };
  const tries = Math.max(1, Math.floor(attempts) || 1);
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      last = await probe(url, fetchImpl);
    } catch (error) {
      last = { ok: false, reason: `request failed: ${error?.message ?? error}` };
    }
    if (last.ok) {
      log(`source URL answers 200 without sign-in: ${url}`);
      return { ok: true, url };
    }
    log(`attempt ${attempt}: ${url} ${last.reason}`);
    if (last.final) {
      break;
    }
    if (attempt < tries) {
      await sleep(delayMs);
    }
  }
  return { ok: false, reason: `${url} is not publicly reachable: ${last.reason}` };
};

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const result = await checkSourceUrl(process.argv[2]);
  if (!result.ok) {
    console.error(`[kerbwell-source-gate] refused: ${result.reason}`);
    process.exit(1);
  }
}
