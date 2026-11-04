import { brandProductName } from '@documenso/lib/constants/brand';
import { i18n, type MessageDescriptor } from '@lingui/core';

/**
 * Black Shard fork: identity severance. This is the app-wide title/meta source;
 * upstream rendered "Documenso" / "Documenso, Inc." / marketing copy on every
 * page. Internal e-sign surface behind the portal, so noindex + neutral copy.
 */
export const appMetaTags = (title?: MessageDescriptor) => {
  const description = `${brandProductName()} - internal document signing.`;

  return [
    {
      title: title ? `${i18n._(title)} · ${brandProductName()}` : brandProductName(),
    },
    {
      name: 'description',
      content: description,
    },
    {
      name: 'robots',
      content: 'noindex, nofollow',
    },
    {
      property: 'og:title',
      content: brandProductName(),
    },
    {
      property: 'og:description',
      content: description,
    },
    {
      property: 'og:type',
      content: 'website',
    },
  ];
};
