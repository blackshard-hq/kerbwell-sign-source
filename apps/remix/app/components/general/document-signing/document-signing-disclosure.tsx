import { KERBWELL_DISCLOSURE_VERSION } from '@documenso/lib/constants/kerbwell-disclosure';
import { cn } from '@documenso/ui/lib/utils';

import type { HTMLAttributes } from 'react';
import { Link } from 'react-router';

export type DocumentSigningDisclosureProps = HTMLAttributes<HTMLParagraphElement>;

/**
 * The short disclosure beside a signature (fork change, Kerbwell Sign): Australian wording, linking
 * to the versioned disclosure page. English text, as the versioned disclosure is.
 */
export const DocumentSigningDisclosure = ({ className, ...props }: DocumentSigningDisclosureProps) => {
  return (
    <p className={cn('text-foreground/80 text-xs leading-5', className)} {...props}>
      You are signing electronically under the Electronic Transactions Act 1999 (Cth) and your state or territory's
      electronic transactions law. You can ask for paper instead before you sign.{' '}
      <Link
        className="inline-block py-1 text-foreground underline underline-offset-4"
        to="/articles/signature-disclosure"
        target="_blank"
      >
        Read the signing disclosure (version {KERBWELL_DISCLOSURE_VERSION})
      </Link>
    </p>
  );
};
