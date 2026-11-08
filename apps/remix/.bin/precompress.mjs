/**
 * Writes .br and .gz beside every compressible built asset (fork addition, Kerbwell Sign), so
 * server/main.js serves them with `precompressed: true` and no per-request compression. Until an
 * edge compresses for it, the origin is what a signer's phone downloads: the signing page's
 * scripts, the pdf.js worker and the signature font are about 4.9 MB raw and about a quarter of
 * that compressed.
 *
 * Usage: node .bin/precompress.mjs build/client
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const COMPRESSIBLE = new Set(['.js', '.mjs', '.css', '.svg', '.json', '.ttf', '.otf', '.txt', '.webmanifest', '.map']);
const MIN_BYTES = 1024;

const root = process.argv[2];

if (!root) {
  console.error('usage: precompress.mjs <dir>');
  process.exit(2);
}

let files = 0;
let rawBytes = 0;
let brBytes = 0;

const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stats = statSync(path);

    if (stats.isDirectory()) {
      walk(path);
      continue;
    }

    if (!COMPRESSIBLE.has(extname(name)) || stats.size < MIN_BYTES) {
      continue;
    }

    const raw = readFileSync(path);
    const br = brotliCompressSync(raw, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 11,
        [constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
      },
    });
    const gz = gzipSync(raw, { level: 9 });

    // Only keep an encoding that is actually smaller.
    if (br.length < raw.length) {
      writeFileSync(`${path}.br`, br);
    }

    if (gz.length < raw.length) {
      writeFileSync(`${path}.gz`, gz);
    }

    files++;
    rawBytes += raw.length;
    brBytes += Math.min(br.length, raw.length);
  }
};

walk(root);

console.log(
  `[Build]: Precompressed ${files} files, ${Math.round(rawBytes / 1024)} KB raw, ${Math.round(brBytes / 1024)} KB brotli`,
);
