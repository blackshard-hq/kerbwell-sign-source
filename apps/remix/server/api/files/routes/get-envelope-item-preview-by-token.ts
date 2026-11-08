import { getFirstPagePreview } from '@documenso/lib/server-only/pdf/first-page-preview';
import { getFileServerSide } from '@documenso/lib/universal/upload/get-file.server';
import { prisma } from '@documenso/prisma';
import { sValidator } from '@hono/standard-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import type { HonoEnv } from '../../../router';

const route = new Hono<HonoEnv>();

const ZParams = z.object({
  token: z.string().min(1),
  envelopeId: z.string().min(1),
  envelopeItemId: z.string().min(1),
  documentDataId: z.string().min(1),
  version: z.enum(['initial', 'current']),
});

/**
 * The first page of an envelope item as a WebP, for a recipient token (fork addition, Kerbwell
 * Sign). The signing page shows it in its server-rendered HTML while pdf.js loads, so a phone's
 * largest paint does not wait for the JavaScript. Same access as item.pdf beside it: the token's
 * recipient must be on the envelope, and under the Kerbwell gate the /api/files/token/ guard also
 * needs that recipient's gate session. Completion certificate (qr_) tokens get no preview.
 */
route.get(
  '/token/:token/envelope/:envelopeId/envelopeItem/:envelopeItemId/dataId/:documentDataId/:version/page-1.webp',
  sValidator('param', ZParams),
  async (c) => {
    const { token, envelopeId, envelopeItemId, documentDataId, version } = c.req.valid('param');

    if (token.startsWith('qr_')) {
      return c.json({ error: 'Not found' }, 404);
    }

    const envelopeItem = await prisma.envelopeItem.findFirst({
      where: {
        id: envelopeItemId,
        documentDataId,
        envelope: { id: envelopeId, recipients: { some: { token } } },
      },
      include: { documentData: true },
    });

    if (!envelopeItem) {
      return c.json({ error: 'Not found' }, 404);
    }

    const { documentData } = envelopeItem;
    const storedData = version === 'current' ? documentData.data : documentData.initialData;

    const preview = await getFirstPagePreview(storedData, async () =>
      getFileServerSide({ type: documentData.type, data: storedData }),
    ).catch((error) => {
      console.error(error);

      return null;
    });

    if (!preview) {
      return c.json({ error: 'Not found' }, 404);
    }

    const etag = `"${preview.etag}"`;

    c.header('ETag', etag);
    c.header('Cache-Control', 'private, max-age=300');
    c.header('Vary', 'Cookie');

    if (c.req.header('If-None-Match') === etag) {
      return c.body(null, 304);
    }

    c.header('Content-Type', 'image/webp');
    c.header('X-Kerbwell-Preview-Size', `${preview.width}x${preview.height}`);

    return c.body(new Uint8Array(preview.image));
  },
);

export default route;
