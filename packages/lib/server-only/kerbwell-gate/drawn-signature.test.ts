import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  configOn: true,
  session: null as null | { docKind: string; recipientId: number },
  storedImages: [] as string[],
}));

vi.mock('@documenso/prisma', () => ({
  prisma: {
    signature: {
      findFirst: vi.fn(async ({ where }: { where: { signatureImageAsBase64: string } }) =>
        state.storedImages.includes(where.signatureImageAsBase64) ? { id: 1 } : null,
      ),
    },
  },
}));

vi.mock('./config', () => ({
  getKerbwellGateConfig: () => (state.configOn ? { mode: 'all' } : null),
}));

vi.mock('./session', () => ({
  getKerbwellGateSessionForRecipient: vi.fn(async (_cookie: string | null, recipientId: number) =>
    state.session && state.session.recipientId === recipientId ? state.session : null,
  ),
}));

const { KERBWELL_UPLOAD_REFUSED, renderKerbwellDrawnSignature, resolveKerbwellSignatureImage } = await import(
  './drawn-signature'
);
const { ZKerbwellDrawnSignature } = await import('../../types/kerbwell-drawn-signature');

const drawn = {
  width: 600,
  height: 200,
  color: 'black' as const,
  lines: [
    [
      [40, 120],
      [80, 90],
      [120, 130],
      [160, 80],
      [200, 140],
      [240, 70],
    ] as Array<[number, number]>,
  ],
};

/** A real-looking uploaded image: any PNG the browser made, here a server render of other strokes. */
const UPLOADED =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const decodePng = (dataUrl: string) => Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');

beforeEach(() => {
  state.configOn = true;
  state.session = { docKind: 'agency_agreement', recipientId: 42 };
  state.storedImages = [];
});

describe('renderKerbwellDrawnSignature', () => {
  it('renders the strokes to a PNG of the pad size with ink on it', async () => {
    const { Image, Canvas } = await import('skia-canvas');

    const image = await renderKerbwellDrawnSignature(drawn);
    expect(image.startsWith('data:image/png;base64,')).toBe(true);

    const img = new Image();
    img.src = decodePng(image);
    await img.decode?.();
    expect(img.width).toBe(600);
    expect(img.height).toBe(200);

    const canvas = new Canvas(600, 200);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const pixels = ctx.getImageData(0, 0, 600, 200).data;

    let inked = 0;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] > 0) {
        inked++;
      }
    }

    expect(inked).toBeGreaterThan(200);
  });

  it('is deterministic, so a re-sent adopted signature renders the same bytes', async () => {
    expect(await renderKerbwellDrawnSignature(drawn)).toBe(await renderKerbwellDrawnSignature(drawn));
  });
});

describe('ZKerbwellDrawnSignature', () => {
  it('refuses points off the pad, unknown colours, empty strokes and oversized pads', () => {
    expect(ZKerbwellDrawnSignature.safeParse(drawn).success).toBe(true);
    expect(ZKerbwellDrawnSignature.safeParse({ ...drawn, lines: [[[601, 10]]] }).success).toBe(false);
    expect(ZKerbwellDrawnSignature.safeParse({ ...drawn, lines: [[[-1, 10]]] }).success).toBe(false);
    expect(ZKerbwellDrawnSignature.safeParse({ ...drawn, color: 'url(#x)' }).success).toBe(false);
    expect(ZKerbwellDrawnSignature.safeParse({ ...drawn, lines: [] }).success).toBe(false);
    expect(ZKerbwellDrawnSignature.safeParse({ ...drawn, width: 100_000 }).success).toBe(false);

    const tooMany = Array.from({ length: 5 }, () => Array.from({ length: 4500 }, () => [1, 1] as [number, number]));
    expect(ZKerbwellDrawnSignature.safeParse({ ...drawn, lines: tooMany }).success).toBe(false);
  });
});

describe('resolveKerbwellSignatureImage', () => {
  it('refuses an image with no strokes on an agency agreement (an upload sent straight to the API)', async () => {
    const err = await resolveKerbwellSignatureImage({ recipientId: 42, value: UPLOADED, drawn: undefined }).catch(
      (e) => e,
    );

    expect(err.code).toBe(KERBWELL_UPLOAD_REFUSED);
    expect(err.statusCode).toBe(400);
  });

  it('stores the server render of the strokes, not the image the browser sent', async () => {
    const stored = await resolveKerbwellSignatureImage({ recipientId: 42, value: UPLOADED, drawn });

    expect(stored).not.toBe(UPLOADED);
    expect(stored).toBe(await renderKerbwellDrawnSignature(drawn));
  });

  it('refuses malformed strokes', async () => {
    const err = await resolveKerbwellSignatureImage({
      recipientId: 42,
      value: UPLOADED,
      drawn: { ...drawn, lines: [[[9999, 9999]]] },
    }).catch((e) => e);

    expect(err.code).toBe(KERBWELL_UPLOAD_REFUSED);
  });

  it('accepts, without strokes, an image the server already rendered for this recipient', async () => {
    const earlier = await renderKerbwellDrawnSignature(drawn);
    state.storedImages.push(earlier);

    await expect(resolveKerbwellSignatureImage({ recipientId: 42, value: earlier, drawn: undefined })).resolves.toBe(
      earlier,
    );
  });

  it('applies the v1 isBase64 flag, not only the data URL prefix', async () => {
    const err = await resolveKerbwellSignatureImage({
      recipientId: 42,
      value: 'not-a-data-url',
      drawn: undefined,
      isImage: true,
    }).catch((e) => e);

    expect(err.code).toBe(KERBWELL_UPLOAD_REFUSED);
  });

  it('leaves typed signatures, other document kinds, other recipients and a gate-off fork alone', async () => {
    await expect(
      resolveKerbwellSignatureImage({ recipientId: 42, value: 'Jordan Citizen', drawn: undefined }),
    ).resolves.toBe('Jordan Citizen');

    state.session = { docKind: 'general_non_prescribed', recipientId: 42 };
    await expect(resolveKerbwellSignatureImage({ recipientId: 42, value: UPLOADED, drawn: undefined })).resolves.toBe(
      UPLOADED,
    );

    state.session = { docKind: 'agency_agreement', recipientId: 7 };
    await expect(resolveKerbwellSignatureImage({ recipientId: 42, value: UPLOADED, drawn: undefined })).resolves.toBe(
      UPLOADED,
    );

    state.session = { docKind: 'agency_agreement', recipientId: 42 };
    state.configOn = false;
    await expect(resolveKerbwellSignatureImage({ recipientId: 42, value: UPLOADED, drawn: undefined })).resolves.toBe(
      UPLOADED,
    );
  });
});
