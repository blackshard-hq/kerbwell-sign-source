import { NEXT_PUBLIC_WEBAPP_URL } from '@documenso/lib/constants/app';
import { brandProductName } from '@documenso/lib/constants/brand';
import { getDocumentByAccessToken } from '@documenso/lib/server-only/document/get-document-by-access-token';
import { redirect, useLoaderData } from 'react-router';
import { DocumentCertificateQRView } from '~/components/general/document/document-certificate-qr-view';
import type { Route } from './+types/share.$slug';

export function meta({ params: { slug } }: Route.MetaArgs) {
  if (slug.startsWith('qr_')) {
    return undefined;
  }

  return [
    { title: `${brandProductName()} - Share` },
    { description: `Signed with ${brandProductName()}` },
    {
      property: 'og:title',
      content: `${brandProductName()} - Share`,
    },
    {
      property: 'og:description',
      content: `Signed with ${brandProductName()}`,
    },
    {
      property: 'og:type',
      content: 'website',
    },
    {
      property: 'og:image',
      content: `${NEXT_PUBLIC_WEBAPP_URL()}/share/${slug}/opengraph`,
    },
    {
      name: 'twitter:card',
      content: 'summary_large_image',
    },
    {
      name: 'twitter:image',
      content: `${NEXT_PUBLIC_WEBAPP_URL()}/share/${slug}/opengraph`,
    },
    {
      name: 'twitter:description',
      content: `Signed with ${brandProductName()}`,
    },
  ];
}

export const loader = async ({ request, params: { slug } }: Route.LoaderArgs) => {
  if (slug.startsWith('qr_')) {
    const document = await getDocumentByAccessToken({ token: slug });

    if (!document) {
      throw redirect('/');
    }

    return {
      document,
      token: slug,
    };
  }

  const userAgent = request.headers.get('User-Agent') ?? '';

  if (/bot|facebookexternalhit|WhatsApp|google|bing|duckduckbot|MetaInspector/i.test(userAgent)) {
    return {};
  }

  throw redirect('/');
};

export default function SharePage() {
  const { document, token } = useLoaderData<typeof loader>();

  if (document) {
    return (
      <DocumentCertificateQRView
        documentId={document.id}
        title={document.title}
        documentTeamUrl={document.documentTeamUrl}
        internalVersion={document.internalVersion}
        envelopeItems={document.envelopeItems}
        recipientCount={document.recipientCount}
        completedDate={document.completedAt ?? undefined}
        token={token}
      />
    );
  }

  return <div></div>;
}
