import { createHash } from 'node:crypto';

import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { Canvas } from 'skia-canvas';

import { SkiaCanvasFactory } from '../ai/pdf-to-images';

/**
 * A WebP of a PDF's first page (fork addition, Kerbwell Sign), shown by the signing page while the
 * browser loads pdf.js and renders the document itself. On a phone the page's largest paint is the
 * first page; with this image in the server-rendered HTML it no longer waits for the JavaScript.
 *
 * Renders are kept in memory by a hash of the stored PDF data, a few at a time, and concurrent
 * requests for the same PDF share one render.
 */
export const FIRST_PAGE_PREVIEW_WIDTH = 800;

const QUALITY = 0.6;
const MAX_CACHED = 24;

export type FirstPagePreview = {
  image: Buffer;
  width: number;
  height: number;
  etag: string;
};

const cache = new Map<string, Promise<FirstPagePreview>>();

export const firstPagePreviewKey = (storedData: string) => createHash('sha256').update(storedData).digest('hex');

export const renderFirstPagePreview = async (pdfBytes: Uint8Array, width = FIRST_PAGE_PREVIEW_WIDTH) => {
  const task = pdfjsLib.getDocument({
    data: pdfBytes,
    CanvasFactory: SkiaCanvasFactory,
    isEvalSupported: false,
  });

  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(1);

    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: width / base.width });

    const canvas = new Canvas(Math.floor(viewport.width), Math.floor(viewport.height));
    canvas.gpu = false;

    const canvasContext = canvas.getContext('2d');

    // A white sheet under the page, as the viewer shows it.
    canvasContext.fillStyle = '#ffffff';
    canvasContext.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      // @ts-expect-error skia-canvas satisfies the requirements
      canvas,
      // @ts-expect-error skia-canvas satisfies the requirements
      canvasContext,
      viewport,
    }).promise;

    const image = await canvas.toBuffer('webp', { quality: QUALITY });

    void page.cleanup();

    return { image, width: canvas.width, height: canvas.height };
  } finally {
    void task.destroy().catch(() => undefined);
  }
};

/**
 * The cached preview for this stored PDF data, rendering it on first use. `load` fetches the PDF
 * bytes and runs only on a cache miss.
 */
export const getFirstPagePreview = async (
  storedData: string,
  load: () => Promise<Uint8Array>,
): Promise<FirstPagePreview> => {
  const etag = firstPagePreviewKey(storedData);
  const cached = cache.get(etag);

  if (cached) {
    // Most recently used last.
    cache.delete(etag);
    cache.set(etag, cached);

    return await cached;
  }

  const pending = (async () => {
    const preview = await renderFirstPagePreview(await load());

    return { ...preview, etag };
  })();

  cache.set(etag, pending);
  pending.catch(() => cache.delete(etag));

  while (cache.size > MAX_CACHED) {
    const oldest = cache.keys().next().value;

    if (oldest === undefined) {
      break;
    }

    cache.delete(oldest);
  }

  return await pending;
};
