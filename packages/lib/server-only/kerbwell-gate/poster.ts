import { prisma } from '@documenso/prisma';

/**
 * The first-page image the signing page shows first (apps/remix/server/api/files/routes
 * get-envelope-item-preview-by-token.ts), as a same-origin path for a `Link: rel=preload` header on
 * the page. The signing page renders the envelope's first item (by order) at version `current`, so
 * this is the same URL its poster asks for. Null for v1 documents, which have no poster.
 */
export const getKerbwellPosterPreloadPath = async (recipientId: number, token: string) => {
  const item = await prisma.envelopeItem.findFirst({
    where: { envelope: { internalVersion: 2, recipients: { some: { id: recipientId } } } },
    orderBy: { order: 'asc' },
    select: { id: true, envelopeId: true, documentDataId: true },
  });

  if (!item) {
    return null;
  }

  return `/api/files/token/${token}/envelope/${item.envelopeId}/envelopeItem/${item.id}/dataId/${item.documentDataId}/current/page-1.webp`;
};

export const kerbwellPosterLinkHeader = (path: string) => `<${path}>; rel=preload; as=image; fetchpriority=high`;
