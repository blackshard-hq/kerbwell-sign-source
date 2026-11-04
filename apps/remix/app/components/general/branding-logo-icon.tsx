import { brandMarkDarkPath, brandMarkPath, brandName } from '@documenso/lib/constants/brand';
import { cn } from '@documenso/ui/lib/utils';
import type { HTMLAttributes } from 'react';

/**
 * The instance's square mark, for places that want the icon only. Defaults to the Black Shard
 * shard tile (brand kit v3.0); BRAND_MARK_PATH and BRAND_MARK_DARK_PATH swap it.
 */
export type LogoProps = HTMLAttributes<HTMLSpanElement>;

export const BrandingLogoIcon = ({ className, ...props }: LogoProps) => {
  return (
    <span className={cn('inline-block', className)} {...props}>
      <img
        src={brandMarkPath()}
        alt={brandName()}
        width={300}
        height={300}
        className="block h-full w-auto dark:hidden"
      />
      <img
        src={brandMarkDarkPath()}
        alt={brandName()}
        width={300}
        height={300}
        className="hidden h-full w-auto dark:block"
      />
    </span>
  );
};
