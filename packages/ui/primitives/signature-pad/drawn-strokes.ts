import type { TKerbwellDrawnSignature } from '@documenso/lib/types/kerbwell-drawn-signature';

/**
 * The strokes behind each image the draw pad produced in this page (fork addition, Kerbwell
 * Sign), keyed by the image's data URL. The sign calls send them as `kerbwellDrawn`, so on an
 * agency agreement the server can render the signature from the strokes instead of trusting an
 * image (packages/lib/server-only/kerbwell-gate/drawn-signature.ts). Images from Upload never get
 * an entry.
 */
const MAX_ENTRIES = 8;

const strokesByImage = new Map<string, TKerbwellDrawnSignature>();

export const rememberDrawnStrokes = (image: string, drawn: TKerbwellDrawnSignature) => {
  strokesByImage.delete(image);
  strokesByImage.set(image, drawn);

  while (strokesByImage.size > MAX_ENTRIES) {
    const oldest = strokesByImage.keys().next().value;

    if (oldest === undefined) {
      break;
    }

    strokesByImage.delete(oldest);
  }
};

export const drawnStrokesFor = (image: string | null | undefined): TKerbwellDrawnSignature | undefined =>
  image ? strokesByImage.get(image) : undefined;

const clamp = (n: number, max: number) => Math.min(Math.max(n, 0), max);

/** The pad's lines as strokes on a canvas of this size, points clamped to the canvas. */
export const toDrawnStrokes = (
  canvas: { width: number; height: number },
  color: string,
  lines: Array<Array<{ x: number; y: number }>>,
): TKerbwellDrawnSignature | null => {
  if (!['black', 'red', 'blue', 'green'].includes(color) || lines.length === 0) {
    return null;
  }

  const width = Math.round(canvas.width);
  const height = Math.round(canvas.height);

  return {
    width,
    height,
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    color: color as TKerbwellDrawnSignature['color'],
    lines: lines
      .filter((line) => line.length > 0)
      .map((line) => line.map((p) => [clamp(p.x, width), clamp(p.y, height)] as [number, number])),
  };
};
