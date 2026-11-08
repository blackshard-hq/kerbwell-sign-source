import { describe, expect, it } from 'vitest';

import { getKerbwellGateConfig, type KerbwellGateConfig } from './config';
import { buildKerbwellPasskeyOfferUrl, buildKerbwellSignerActionLinks } from './signer-ui';

const ISSUER = 'https://auth.kerbwell.com.au';
const session = { recipientId: 42, envelopeId: 'envelope_abc', mode: 'remote' };

const configWith = (env: Record<string, string>) =>
  getKerbwellGateConfig({ NEXT_PRIVATE_KERBWELL_GATE_ISSUER: ISSUER, ...env }) as KerbwellGateConfig;

describe('kerbwell signer UI links', () => {
  it('has no action links without an actions page', () => {
    expect(buildKerbwellSignerActionLinks(configWith({}), session)).toBeNull();
  });

  it('links each action to the portal page with the recipient and envelope', () => {
    const links = buildKerbwellSignerActionLinks(
      configWith({ NEXT_PRIVATE_KERBWELL_GATE_ACTIONS_URL: 'https://vendor.kerbwell.com.au/s/actions' }),
      session,
    );

    expect(links).not.toBeNull();

    for (const action of ['ask', 'decline', 'wrong-person', 'paper'] as const) {
      const url = new URL(links?.[action] ?? '');

      expect(url.origin + url.pathname).toBe('https://vendor.kerbwell.com.au/s/actions');
      expect(url.searchParams.get('action')).toBe(action);
      expect(url.searchParams.get('recipient')).toBe('42');
      expect(url.searchParams.get('envelope')).toBe('envelope_abc');
    }
  });

  it('refuses a plain http actions page off loopback', () => {
    expect(() => configWith({ NEXT_PRIVATE_KERBWELL_GATE_ACTIONS_URL: 'http://vendor.kerbwell.com.au/s' })).toThrow(
      /must be https/,
    );
  });

  it('offers a passkey on the issuer, never in kiosk mode', () => {
    const config = configWith({});

    expect(buildKerbwellPasskeyOfferUrl(config, session)).toBe(
      `${ISSUER}/signer/passkey?recipient=42&envelope=envelope_abc`,
    );
    expect(buildKerbwellPasskeyOfferUrl(config, { ...session, mode: 'in_person' })).toBeNull();
  });

  it('pins the passkey offer to the issuer origin', () => {
    expect(() => configWith({ NEXT_PRIVATE_KERBWELL_GATE_PASSKEY_URL: 'https://evil.example/passkey' })).toThrow(
      /issuer origin/,
    );
  });
});
