import { env } from '../utils/env';

/**
 * The brand this instance presents, read from the environment.
 *
 * One image serves more than one deployment: the estate's own eSign and a product's signing
 * service (Kerbwell Sign). Every user-visible brand string reads from here, and each default is
 * the value the estate shipped before this layer existed, so an instance that sets no BRAND_*
 * variable renders exactly as it did.
 *
 * BRAND_* variables are not secrets. createPublicEnv (utils/env.ts) forwards every BRAND_* key
 * to the browser through window.__ENV__, so the same getter answers on the server and in the
 * client and hydration sees the brand the server rendered.
 *
 * Getters, not constants: a module-level read on the client can run before window.__ENV__ is
 * set, and a getter costs nothing.
 */

const read = (key: string): string | undefined => {
  const value = env(key);

  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
};

export const BRAND_DEFAULTS = {
  name: 'Black Shard',
  productName: 'Black Shard eSign',
  url: 'https://esign.blackshard.com.au',
  fromName: 'Black Shard eSign',
  fromAddress: 'noreply@esign.blackshard.com.au',
  supportEmail: 'flint@blackshard.com.au',
  logoPath: '/static/blackshard-primary-light.svg',
  logoDarkPath: '/static/blackshard-primary-dark.svg',
  markPath: '/static/blackshard-mark-light.svg',
  markDarkPath: '/static/blackshard-mark-dark.svg',
  emailLogoPath: '/static/logo.png',
  fileSlug: 'blackshard-esign',
  securityContact: 'mailto:info@blackshard.com.au',
  securityPolicy: 'https://blackshard.com.au/trust#disclosure',
  securityExpires: '2027-06-17T00:00:00.000Z',
} as const;

/** The company, e.g. "Kerbwell". */
export const brandName = () => read('BRAND_NAME') ?? BRAND_DEFAULTS.name;

/** The signing product, e.g. "Kerbwell Sign". */
export const brandProductName = () => read('BRAND_PRODUCT_NAME') ?? BRAND_DEFAULTS.productName;

/** Where "sent using <product>" and "Powered by" link to. */
export const brandUrl = () => read('BRAND_URL') ?? BRAND_DEFAULTS.url;

/** The display host of brandUrl, for link text. */
export const brandUrlHost = () => {
  try {
    return new URL(brandUrl()).host;
  } catch {
    return brandUrl();
  }
};

/** Mail From, under the SMTP-specific NEXT_PRIVATE_SMTP_FROM_* which still win when set. */
export const brandFromName = () =>
  read('NEXT_PRIVATE_SMTP_FROM_NAME') ?? read('BRAND_FROM_NAME') ?? BRAND_DEFAULTS.fromName;

export const brandFromAddress = () =>
  read('NEXT_PRIVATE_SMTP_FROM_ADDRESS') ?? read('BRAND_FROM_ADDRESS') ?? BRAND_DEFAULTS.fromAddress;

/** The support mailbox. NEXT_PUBLIC_SUPPORT_EMAIL, the upstream name, still wins when set. */
export const brandSupportEmail = () =>
  read('NEXT_PUBLIC_SUPPORT_EMAIL') ?? read('BRAND_SUPPORT_EMAIL') ?? BRAND_DEFAULTS.supportEmail;

/** The lockup on light backgrounds, a path under /public or an absolute URL. */
export const brandLogoPath = () => read('BRAND_LOGO_PATH') ?? BRAND_DEFAULTS.logoPath;

/** The lockup on dark backgrounds. A brand that sets only BRAND_LOGO_PATH uses it for both. */
export const brandLogoDarkPath = () =>
  read('BRAND_LOGO_DARK_PATH') ?? read('BRAND_LOGO_PATH') ?? BRAND_DEFAULTS.logoDarkPath;

/** The square mark. A brand without one falls back to its lockup. */
export const brandMarkPath = () => read('BRAND_MARK_PATH') ?? read('BRAND_LOGO_PATH') ?? BRAND_DEFAULTS.markPath;

export const brandMarkDarkPath = () =>
  read('BRAND_MARK_DARK_PATH') ??
  read('BRAND_MARK_PATH') ??
  read('BRAND_LOGO_DARK_PATH') ??
  read('BRAND_LOGO_PATH') ??
  BRAND_DEFAULTS.markDarkPath;

/** The raster lockup email clients get (they do not all render SVG), a path under /public. */
export const brandEmailLogoPath = () => read('BRAND_EMAIL_LOGO_PATH') ?? BRAND_DEFAULTS.emailLogoPath;

/**
 * The prefix on files the app hands a user to save (bulk downloads, recovery codes, CSV
 * templates). Derived from BRAND_PRODUCT_NAME when set ("Kerbwell Sign" -> "kerbwell-sign").
 */
export const brandFileSlug = () => {
  const product = read('BRAND_PRODUCT_NAME');

  if (product === undefined) {
    return BRAND_DEFAULTS.fileSlug;
  }

  const slug = product
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug === '' ? BRAND_DEFAULTS.fileSlug : slug;
};

/** The site footer line. Unset keeps the estate's two-line entity footer. */
export const brandFooterText = () => read('BRAND_FOOTER_TEXT');

/** The corresponding-source link (AGPL-3.0 section 13). Unset hides the link. */
export const brandSourceUrl = () => read('BRAND_SOURCE_URL');

/**
 * security.txt. A branded instance never falls back to the estate's contact or policy: its
 * contact defaults to its own support mailbox, and with no BRAND_SECURITY_POLICY the Policy line
 * is left out.
 */
export const brandSecurityContact = () =>
  read('BRAND_SECURITY_CONTACT') ??
  (isDefaultBrand() ? BRAND_DEFAULTS.securityContact : `mailto:${brandSupportEmail()}`);

export const brandSecurityPolicy = (): string | undefined =>
  read('BRAND_SECURITY_POLICY') ?? (isDefaultBrand() ? BRAND_DEFAULTS.securityPolicy : undefined);

export const brandSecurityExpires = () => read('BRAND_SECURITY_EXPIRES') ?? BRAND_DEFAULTS.securityExpires;

/**
 * Whether this instance runs the estate's own brand. The estate footer carries entity details
 * that are not a single env line, so it is kept as written when no brand is set.
 */
export const isDefaultBrand = () => read('BRAND_NAME') === undefined;
