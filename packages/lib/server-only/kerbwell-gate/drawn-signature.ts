import { prisma } from '@documenso/prisma';
import { getStroke } from 'perfect-freehand';

import { isBase64Image } from '../../constants/signatures';
import { AppError } from '../../errors/app-error';
import { type TKerbwellDrawnSignature, ZKerbwellDrawnSignature } from '../../types/kerbwell-drawn-signature';
import { getKerbwellGateConfig } from './config';
import { getKerbwellGateRequestCookieHeader } from './request-store';
import { getKerbwellGateSessionForRecipient } from './session';

/**
 * Server-side "no upload on an agency agreement" (fork addition, Kerbwell Sign).
 *
 * A drawn signature and an uploaded one both reach the server as a canvas PNG, so the image alone
 * cannot show where it came from. On an agency agreement the server therefore does not take the
 * browser's image. The signer's browser sends the pen strokes it drew (`kerbwellDrawn`), and the
 * server renders the stored PNG from those strokes with the pad's own stroke settings. An image
 * sent without strokes is refused, unless it is byte for byte a signature the server already
 * rendered for this recipient (the same adopted signature placed on a second field). Typed
 * signatures are text and pass as they are.
 */
export const KERBWELL_UPLOAD_REFUSED = 'KERBWELL_UPLOAD_REFUSED';

/** The draw pad's perfect-freehand settings (packages/ui/primitives/signature-pad/signature-pad-draw.tsx). */
const STROKE_SIZE = 10;

const STROKE_OPTIONS = {
  size: STROKE_SIZE,
  thinning: 0.25,
  streamline: 0.5,
  smoothing: 0.5,
  end: { taper: STROKE_SIZE * 2 },
};

const average = (a: number, b: number) => (a + b) / 2;

/** Same as packages/ui/primitives/signature-pad/helper.ts getSvgPathFromStroke. */
const svgPathFromStroke = (points: number[][]) => {
  if (points.length < 4) {
    return '';
  }

  let a = points[0];
  let b = points[1];
  const c = points[2];

  let result = `M${a[0].toFixed(2)},${a[1].toFixed(2)} Q${b[0].toFixed(2)},${b[1].toFixed(2)} ${average(
    b[0],
    c[0],
  ).toFixed(2)},${average(b[1], c[1]).toFixed(2)} T`;

  for (let i = 2, max = points.length - 1; i < max; i++) {
    a = points[i];
    b = points[i + 1];
    result += `${average(a[0], b[0]).toFixed(2)},${average(a[1], b[1]).toFixed(2)} `;
  }

  return `${result}Z`;
};

/** Renders the strokes to a PNG data URL, as the draw pad draws them. */
export const renderKerbwellDrawnSignature = async (drawn: TKerbwellDrawnSignature): Promise<string> => {
  const { Canvas, Path2D } = await import('skia-canvas');

  const canvas = new Canvas(drawn.width, drawn.height);
  const ctx = canvas.getContext('2d');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = drawn.color;

  for (const line of drawn.lines) {
    const path = svgPathFromStroke(getStroke(line, STROKE_OPTIONS));

    if (path) {
      ctx.fill(new Path2D(path));
    }
  }

  const png = await canvas.toBuffer('png');

  return `data:image/png;base64,${png.toString('base64')}`;
};

const uploadRefused = (message: string) => new AppError(KERBWELL_UPLOAD_REFUSED, { message, statusCode: 400 });

/**
 * The signature image to store for a signature field. Unchanged unless this request holds a gate
 * session for the recipient on an agency agreement and the value is an image; then the image is
 * rendered from `drawn`, or refused.
 */
export const resolveKerbwellSignatureImage = async ({
  recipientId,
  value,
  drawn,
  isImage = isBase64Image(value),
  cookieHeader = getKerbwellGateRequestCookieHeader(),
}: {
  recipientId: number;
  value: string;
  drawn: unknown;
  /** Whether the value is stored as an image. The v1 route takes the caller's isBase64 flag. */
  isImage?: boolean;
  cookieHeader?: string | null;
}): Promise<string> => {
  if (!getKerbwellGateConfig() || !isImage) {
    return value;
  }

  const session = await getKerbwellGateSessionForRecipient(cookieHeader, recipientId);

  if (!session || session.docKind !== 'agency_agreement') {
    return value;
  }

  if (drawn !== undefined && drawn !== null) {
    const parsed = ZKerbwellDrawnSignature.safeParse(drawn);

    if (!parsed.success) {
      throw uploadRefused('The drawn signature could not be read. Draw it again or type it.');
    }

    return await renderKerbwellDrawnSignature(parsed.data);
  }

  const earlier = await prisma.signature.findFirst({
    where: { recipientId, signatureImageAsBase64: value },
    select: { id: true },
  });

  if (earlier) {
    return value;
  }

  throw uploadRefused('An uploaded signature cannot be used on this agreement. Draw or type your signature.');
};
