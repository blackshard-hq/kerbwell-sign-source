import {
  brandFooterText,
  brandName,
  brandSourceUrl,
  brandUrl,
  brandUrlHost,
  isDefaultBrand,
} from '@documenso/lib/constants/brand';
import { cn } from '@documenso/ui/lib/utils';

export type SiteFooterProps = {
  className?: string;
};

/**
 * Firm footer for the unauthenticated surfaces (sign in, password reset,
 * email verification). Plain facts, no i18n: the entity details do not vary.
 *
 * With no BRAND_* set this is the estate's entity footer, word for word. A
 * branded instance shows its BRAND_FOOTER_TEXT (or its name) and its own site.
 * Either way, BRAND_SOURCE_URL adds the corresponding-source link.
 */
export const SiteFooter = ({ className }: SiteFooterProps) => {
  const sourceUrl = brandSourceUrl();

  return (
    <footer className={cn('w-full border-border border-t px-4 py-6 md:px-8', className)}>
      <div className="mx-auto flex w-full max-w-screen-xl flex-col gap-y-2 text-muted-foreground text-xs leading-5 md:flex-row md:items-center md:justify-between md:gap-x-8">
        {isDefaultBrand() ? (
          <>
            <p>Black Shard Pty Ltd, ABN 66 696 910 773. Level 35, 71 Eagle Street, Brisbane QLD 4000. 1800 370 270.</p>

            <p className="md:whitespace-nowrap">
              Software engineering and cybersecurity. SMB1001:2026 Gold certified.{' '}
              <a
                href="https://blackshard.com.au"
                target="_blank"
                rel="noreferrer"
                className="whitespace-nowrap text-foreground underline decoration-shard underline-offset-4 hover:opacity-70"
              >
                blackshard.com.au
              </a>
              {sourceUrl && <SourceLink href={sourceUrl} />}
            </p>
          </>
        ) : (
          <>
            <p>{brandFooterText() ?? brandName()}</p>

            <p className="md:whitespace-nowrap">
              <a
                href={brandUrl()}
                target="_blank"
                rel="noreferrer"
                className="whitespace-nowrap text-foreground underline decoration-shard underline-offset-4 hover:opacity-70"
              >
                {brandUrlHost()}
              </a>
              {sourceUrl && <SourceLink href={sourceUrl} />}
            </p>
          </>
        )}
      </div>
    </footer>
  );
};

/** The AGPL-3.0 section 13 offer: where a user of this network service gets its source. */
export const SourceLink = ({ href, className }: { href: string; className?: string }) => (
  <>
    {' '}
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn('text-foreground underline decoration-shard underline-offset-4 hover:opacity-70', className)}
    >
      Source code (AGPL-3.0)
    </a>
  </>
);
