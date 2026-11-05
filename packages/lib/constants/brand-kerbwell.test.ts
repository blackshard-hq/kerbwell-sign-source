import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { brandStylesheetPath } from './brand';

/**
 * Kerbwell Sign's brand stylesheet (apps/remix/public/static/kerbwell-brand.css) carries every
 * semantic colour as an HSL triple with the token's hex beside it. These checks keep the two in
 * step and hold the contrast floors: 7:1 for text pairs (WCAG 2.2 AAA, 1.4.6) and 3:1 for the
 * focus ring and input borders against the page (1.4.11).
 */

const CSS_PATH = path.resolve(__dirname, '../../../apps/remix/public/static/kerbwell-brand.css');
const css = readFileSync(CSS_PATH, 'utf8');

type Rgb = [number, number, number];

const hexToRgb = (hex: string): Rgb => {
  const h = hex.replace('#', '');

  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
};

const hslToRgb = (h: number, s: number, l: number): Rgb => {
  const sat = s / 100;
  const lig = l / 100;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;

    return Math.round(255 * (lig - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };

  return [f(0), f(8), f(4)];
};

const luminance = ([r, g, b]: Rgb) => {
  const lin = (c: number) => {
    const v = c / 255;

    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

const contrast = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);

  return (hi + 0.05) / (lo + 0.05);
};

const block = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} block`).toBeGreaterThan(-1);

  return css.slice(start, css.indexOf('\n}', start));
};

type Token = { triple: [number, number, number]; hex?: string };

const tokens = (body: string) => {
  const out: Record<string, Token> = {};
  const rx = /--([a-z-]+):\s*([\d.]+) ([\d.]+)% ([\d.]+)%;(?:\s*\/\*([^*]*)\*\/)?/g;

  for (const m of body.matchAll(rx)) {
    const hex = /#[0-9A-Fa-f]{6}/.exec(m[5] ?? '')?.[0];
    out[m[1]] = { triple: [Number(m[2]), Number(m[3]), Number(m[4])], hex };
  }

  return out;
};

const light = tokens(block(':root,\n.dark-mode-disabled'));
const dark = tokens(block(':root.dark:not(.dark-mode-disabled)'));

const rgbOf = (set: Record<string, Token>, name: string) => {
  const token = set[name];
  expect(token, `--${name}`).toBeDefined();

  return hslToRgb(...token.triple);
};

const TEXT_PAIRS: Array<[string, string]> = [
  ['foreground', 'background'],
  ['muted-foreground', 'background'],
  ['muted-foreground', 'muted'],
  ['muted-foreground', 'secondary'],
  ['card-foreground', 'card'],
  ['popover-foreground', 'popover'],
  ['primary-foreground', 'primary'],
  ['secondary-foreground', 'secondary'],
  ['accent-foreground', 'accent'],
  ['destructive-foreground', 'destructive'],
  ['field-card-foreground', 'field-card'],
  ['widget-foreground', 'widget'],
];

const MARK_PAIRS: Array<[string, string]> = [
  ['ring', 'background'],
  ['input', 'background'],
  ['field-card-border', 'field-card'],
];

describe.each([
  ['light', light],
  ['dark', dark],
])('kerbwell-brand.css, %s', (_name, set) => {
  it('defines every semantic colour as a triple that matches its named hex', () => {
    expect(Object.keys(set).length).toBeGreaterThanOrEqual(25);

    for (const [name, token] of Object.entries(set)) {
      expect(token.hex, `--${name} names its hex`).toBeDefined();

      const fromTriple = hslToRgb(...token.triple);
      const fromHex = hexToRgb(token.hex!);

      for (let i = 0; i < 3; i++) {
        expect(Math.abs(fromTriple[i] - fromHex[i]), `--${name} channel ${i}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it.each(TEXT_PAIRS)('%s on %s is 7:1 or better', (fg, bg) => {
    expect(contrast(rgbOf(set, fg), rgbOf(set, bg))).toBeGreaterThanOrEqual(7);
  });

  it.each(MARK_PAIRS)('%s against %s is 3:1 or better', (fg, bg) => {
    expect(contrast(rgbOf(set, fg), rgbOf(set, bg))).toBeGreaterThanOrEqual(3);
  });
});

describe('kerbwell-brand.css, scope', () => {
  it('carries no cyan and no serif', () => {
    expect(css).not.toMatch(/188 100% 42%|#00b8d4/i);
    expect(css).not.toMatch(/Instrument Serif|IBM Plex/);
  });

  it('loads only same-origin fonts', () => {
    for (const m of css.matchAll(/url\("([^"]+)"\)/g)) {
      expect(m[1]).toMatch(/^\/static\/kerbwell-[a-z0-9-]+\.woff2$/);
    }
  });
});

describe('brandStylesheetPath', () => {
  const original = process.env.BRAND_STYLESHEET_PATH;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.BRAND_STYLESHEET_PATH;
    } else {
      process.env.BRAND_STYLESHEET_PATH = original;
    }
  });

  it('is unset by default, so the estate instance links nothing', () => {
    delete process.env.BRAND_STYLESHEET_PATH;
    expect(brandStylesheetPath()).toBeUndefined();
  });

  it('accepts a same-origin .css path', () => {
    process.env.BRAND_STYLESHEET_PATH = '/static/kerbwell-brand.css';
    expect(brandStylesheetPath()).toBe('/static/kerbwell-brand.css');
  });

  it.each([
    'https://evil.example/x.css',
    '//evil.example/x.css',
    '/static/../secret.css',
    '/static/kerbwell-brand.js',
    'static/kerbwell-brand.css',
    '/static/x.css?inject',
    'javascript:alert(1)',
  ])('refuses %s', (value) => {
    process.env.BRAND_STYLESHEET_PATH = value;
    expect(brandStylesheetPath()).toBeUndefined();
  });
});
