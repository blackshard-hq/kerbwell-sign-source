import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  KERBWELL_DISCLOSURE_SECTIONS,
  KERBWELL_DISCLOSURE_SHA256,
  KERBWELL_DISCLOSURE_VERSION,
  kerbwellDisclosureCanonicalText,
} from './kerbwell-disclosure';

describe('kerbwell disclosure', () => {
  it('the published hash is the SHA-256 of the canonical text (change the version with the text)', () => {
    const hash = createHash('sha256').update(kerbwellDisclosureCanonicalText(), 'utf8').digest('hex');

    expect(hash).toBe(KERBWELL_DISCLOSURE_SHA256);
  });

  it('carries a gate-safe version id', () => {
    // The gate assertion's consent_version is 1 to 64 characters; keep the id inside that.
    expect(KERBWELL_DISCLOSURE_VERSION).toMatch(/^[a-z0-9-]{1,64}$/);
  });

  it('cites the Commonwealth Act and every state and territory Act, and no US law', () => {
    const text = kerbwellDisclosureCanonicalText();

    expect(text).toContain('Electronic Transactions Act 1999 (Cth)');

    for (const act of [
      '(NSW)',
      '(Victoria)',
      '(Queensland)',
      '(WA)',
      'Electronic Communications Act 2000 (SA)',
      '(Tas)',
      '(ACT)',
      '(Northern Territory)',
    ]) {
      expect(text).toContain(act);
    }

    expect(text).not.toMatch(/E-Sign|Global and National Commerce/i);
  });

  it('has no em dashes and offers paper and withdrawal', () => {
    const text = kerbwellDisclosureCanonicalText();

    expect(text).not.toContain('—');
    expect(KERBWELL_DISCLOSURE_SECTIONS.map((s) => s.heading)).toEqual(
      expect.arrayContaining(['Paper instead', 'Withdrawing consent']),
    );
  });
});
