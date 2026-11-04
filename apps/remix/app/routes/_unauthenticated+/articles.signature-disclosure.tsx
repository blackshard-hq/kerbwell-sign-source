import { SUPPORT_EMAIL } from '@documenso/lib/constants/app';
import {
  KERBWELL_DISCLOSURE_EFFECTIVE,
  KERBWELL_DISCLOSURE_SECTIONS,
  KERBWELL_DISCLOSURE_SHA256,
  KERBWELL_DISCLOSURE_TITLE,
  KERBWELL_DISCLOSURE_VERSION,
} from '@documenso/lib/constants/kerbwell-disclosure';

import type { Route } from './+types/articles.signature-disclosure';

export function meta(_args: Route.MetaArgs) {
  return [{ title: KERBWELL_DISCLOSURE_TITLE }];
}

/**
 * The Australian electronic signing disclosure (fork change, Kerbwell Sign). It replaces the
 * upstream page, which cited the US E-Sign Act. The wording is the versioned constant the gate
 * records consent against; see packages/lib/constants/kerbwell-disclosure.ts.
 */
export default function SignatureDisclosure() {
  return (
    <div className="mx-auto w-full max-w-prose">
      <article className="prose dark:prose-invert max-w-none break-words" lang="en-AU">
        <h1>{KERBWELL_DISCLOSURE_TITLE}</h1>

        <p className="text-foreground text-sm" data-testid="disclosure-version">
          Version {KERBWELL_DISCLOSURE_VERSION}, effective {KERBWELL_DISCLOSURE_EFFECTIVE}.
        </p>

        {KERBWELL_DISCLOSURE_SECTIONS.map((section) => (
          <section key={section.heading}>
            <h2>{section.heading}</h2>

            {section.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}

            {section.list && (
              <ul>
                {section.list.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
          </section>
        ))}

        <h2>Questions</h2>
        <p>
          Ask the agent who sent you the document. For a question about this service, write to{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
        </p>

        <p className="break-all text-foreground text-xs">SHA-256 of this wording: {KERBWELL_DISCLOSURE_SHA256}</p>
      </article>
    </div>
  );
}
