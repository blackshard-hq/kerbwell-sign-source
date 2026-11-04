// Tests for docker/kerbwell-source-gate.mjs (AGPL-3.0 s13 gate in the image build).
//
//   node --test docker/kerbwell-source-gate.test.mjs
//
// The logic tests use a fake fetch. The live tests ask GitHub, anonymously, about the real
// public mirror and about this private repository; set KERBWELL_SOURCE_GATE_OFFLINE=1 to skip them.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkSourceUrl, MIRROR_URL_PATTERN } from './kerbwell-source-gate.mjs';

const GOOD = 'https://github.com/blackshard-hq/kerbwell-sign-source/tree/src-d761f5d44375';

const answer = (status, location) => ({
  status,
  headers: { get: (name) => (name.toLowerCase() === 'location' ? (location ?? null) : null) },
  body: { cancel: async () => {} },
});

const fakeFetch = (...answers) => {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const next = answers.length > 1 ? answers.shift() : answers[0];
    if (next instanceof Error) {
      throw next;
    }
    return next;
  };
  fn.calls = calls;
  return fn;
};

const quiet = { attempts: 1, delayMs: 0, log: () => {} };

test('an empty URL is refused without a request', async () => {
  const fetch = fakeFetch(answer(200));
  for (const url of ['', '   ', undefined]) {
    const result = await checkSourceUrl(url, { ...quiet, fetch });
    assert.equal(result.ok, false);
    assert.match(result.reason, /empty/);
  }
  assert.equal(fetch.calls.length, 0);
});

test('a URL that is not a mirror snapshot tag is refused without a request', async () => {
  const fetch = fakeFetch(answer(200));
  const refused = [
    'https://github.com/blackshard-hq/kerbwell-sign/tree/7869966d6',
    'https://github.com/blackshard-hq/kerbwell-sign-source/tree/main',
    'https://github.com/blackshard-hq/kerbwell-sign-source/tree/snapshots',
    'https://github.com/blackshard-hq/kerbwell-sign-source/tree/src-d761f5d4437',
    'https://github.com/blackshard-hq/kerbwell-sign-source/tree/src-D761F5D44375',
    'http://github.com/blackshard-hq/kerbwell-sign-source/tree/src-d761f5d44375',
    'https://github.com/someone/kerbwell-sign-source/tree/src-d761f5d44375',
    'https://github.com.evil.example/blackshard-hq/kerbwell-sign-source/tree/src-d761f5d44375',
    `${GOOD}/`,
    `${GOOD}?x=1`,
    `${GOOD}#x`,
  ];
  for (const url of refused) {
    const result = await checkSourceUrl(url, { ...quiet, fetch });
    assert.equal(result.ok, false, url);
    assert.match(result.reason, /not a public mirror snapshot/, url);
  }
  assert.equal(fetch.calls.length, 0);
  assert.ok(MIRROR_URL_PATTERN.test(GOOD));
});

test('a mirror tag that answers 200 anonymously passes', async () => {
  const fetch = fakeFetch(answer(200));
  const result = await checkSourceUrl(GOOD, { ...quiet, fetch });
  assert.deepEqual(result, { ok: true, url: GOOD });
  assert.equal(fetch.calls.length, 1);
  const { init } = fetch.calls[0];
  assert.equal(init.redirect, 'manual');
  assert.equal(init.credentials, 'omit');
  const sent = Object.keys(init.headers ?? {}).map((h) => h.toLowerCase());
  assert.ok(!sent.includes('authorization'));
  assert.ok(!sent.includes('cookie'));
});

test('a missing or private tag (404) is refused', async () => {
  const result = await checkSourceUrl(GOOD, { ...quiet, fetch: fakeFetch(answer(404)) });
  assert.equal(result.ok, false);
  assert.match(result.reason, /404/);
});

test('a redirect to a sign-in page is refused', async () => {
  for (const location of ['https://github.com/login?return_to=x', '/session', '/login']) {
    const fetch = fakeFetch(answer(302, location), answer(200));
    const result = await checkSourceUrl(GOOD, { ...quiet, fetch });
    assert.equal(result.ok, false, location);
    assert.match(result.reason, /sign-in/, location);
  }
});

test('a redirect off github.com is refused', async () => {
  const fetch = fakeFetch(answer(301, 'https://example.com/source'), answer(200));
  const result = await checkSourceUrl(GOOD, { ...quiet, fetch });
  assert.equal(result.ok, false);
  assert.match(result.reason, /left github\.com/);
});

test('an ordinary redirect inside github.com is followed', async () => {
  const fetch = fakeFetch(answer(301, '/blackshard-hq/kerbwell-sign-source/tree/src-d761f5d44375'), answer(200));
  const result = await checkSourceUrl(GOOD, { ...quiet, fetch });
  assert.equal(result.ok, true);
  assert.equal(fetch.calls.length, 2);
});

test('more than three redirects is refused', async () => {
  const fetch = fakeFetch(answer(302, '/a'));
  const result = await checkSourceUrl(GOOD, { ...quiet, fetch });
  assert.equal(result.ok, false);
  assert.match(result.reason, /redirect/);
});

test('a network failure retries, then refuses', async () => {
  const fetch = fakeFetch(new Error('ECONNREFUSED'));
  const result = await checkSourceUrl(GOOD, { attempts: 3, delayMs: 0, log: () => {}, fetch });
  assert.equal(result.ok, false);
  assert.equal(fetch.calls.length, 3);
});

test('a short publish lag is waited out', async () => {
  const fetch = fakeFetch(answer(404), answer(404), answer(200));
  const result = await checkSourceUrl(GOOD, { attempts: 4, delayMs: 0, log: () => {}, fetch });
  assert.equal(result.ok, true);
  assert.equal(fetch.calls.length, 3);
});

const live = process.env.KERBWELL_SOURCE_GATE_OFFLINE === '1' ? test.skip : test;

live('live: the published mirror tag passes', async () => {
  const result = await checkSourceUrl(GOOD, { attempts: 3, delayMs: 2000, log: () => {} });
  assert.equal(result.ok, true, result.reason);
});

live('live: a mirror-shaped tag that was never published is refused', async () => {
  const url = 'https://github.com/blackshard-hq/kerbwell-sign-source/tree/src-000000000000';
  const result = await checkSourceUrl(url, { attempts: 1, delayMs: 0, log: () => {} });
  assert.equal(result.ok, false);
});
