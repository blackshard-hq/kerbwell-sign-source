import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { getFirstPagePreview, renderFirstPagePreview } from './first-page-preview';

const ASSETS = path.join(__dirname, '../../../../assets');

const loadPdf = async (name: string) => new Uint8Array(await readFile(path.join(ASSETS, name)));

describe('first page preview', () => {
  it('renders page 1 of an A4 PDF as a WebP at the preview width', async () => {
    const preview = await renderFirstPagePreview(await loadPdf('a4-size.pdf'));

    expect(preview.image.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(preview.image.subarray(8, 12).toString('ascii')).toBe('WEBP');
    expect(preview.width).toBe(800);
    expect(Math.abs(preview.height / preview.width - 297 / 210)).toBeLessThan(0.01);
    // Small enough to arrive early on a phone connection.
    expect(preview.image.length).toBeLessThan(80_000);
  });

  it('renders once per stored PDF, and shares the render between concurrent requests', async () => {
    const bytes = await loadPdf('example.pdf');
    const load = vi.fn(async () => bytes);

    const [a, b] = await Promise.all([getFirstPagePreview('stored-1', load), getFirstPagePreview('stored-1', load)]);
    const c = await getFirstPagePreview('stored-1', load);

    expect(load).toHaveBeenCalledTimes(1);
    expect(a.etag).toBe(b.etag);
    expect(c.image).toBe(a.image);
  });

  it('does not cache a failed render', async () => {
    const load = vi.fn(async () => new Uint8Array([1, 2, 3]));

    await expect(getFirstPagePreview('broken', load)).rejects.toBeDefined();
    await expect(getFirstPagePreview('broken', load)).rejects.toBeDefined();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
