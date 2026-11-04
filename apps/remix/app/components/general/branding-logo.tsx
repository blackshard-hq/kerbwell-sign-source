import { brandLogoDarkPath, brandLogoPath, brandName } from '@documenso/lib/constants/brand';
import { cn } from '@documenso/ui/lib/utils';
import type { HTMLAttributes } from 'react';

/**
 * The instance's primary lockup. Defaults to the Black Shard lockup (brand kit v3.0, copied
 * verbatim into /static); BRAND_LOGO_PATH and BRAND_LOGO_DARK_PATH (constants/brand.ts) swap
 * in another brand's files at the same 1042 x 206 box.
 *
 * - `tone="auto"` (default) follows the page theme: obsidian lockup on light
 *   backgrounds, white lockup on dark backgrounds.
 * - `tone="inverse"` flips that, for use on a primary-coloured surface (an
 *   obsidian badge in light mode, a white badge in dark mode).
 *
 * Give the wrapper a height (`h-6`, `h-[14px]`); the image fills it and keeps
 * the lockup's aspect ratio.
 */
export type LogoProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: 'auto' | 'inverse';
};

export const BrandingLogo = ({ className, tone = 'auto', ...props }: LogoProps) => {
  const onLight = brandLogoPath();
  const onDark = brandLogoDarkPath();
  const lightSrc = tone === 'inverse' ? onDark : onLight;
  const darkSrc = tone === 'inverse' ? onLight : onDark;

  return (
    <span className={cn('inline-block', className)} {...props}>
      <img src={lightSrc} alt={brandName()} width={1042} height={206} className="block h-full w-auto dark:hidden" />
      <img src={darkSrc} alt={brandName()} width={1042} height={206} className="hidden h-full w-auto dark:block" />
    </span>
  );
};
