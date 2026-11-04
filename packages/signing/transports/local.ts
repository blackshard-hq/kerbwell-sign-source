import * as fs from 'node:fs';
import { env } from '@documenso/lib/utils/env';
import { P12Signer } from '@libpdf/core';

const loadP12 = (): Uint8Array => {
  const localFileContents = env('NEXT_PRIVATE_SIGNING_LOCAL_FILE_CONTENTS');

  if (localFileContents) {
    return Buffer.from(localFileContents, 'base64');
  }

  const localFilePath = env('NEXT_PRIVATE_SIGNING_LOCAL_FILE_PATH');

  if (localFilePath) {
    return fs.readFileSync(localFilePath);
  }

  // Never silently fall back to the committed, PUBLIC example cert: it ships in
  // the open-source repo, so anyone holds the same private key and could forge a
  // document carrying an identical Black Shard signing identity. The old fallback
  // was gated on NODE_ENV, so a redeploy that dropped NODE_ENV (or set it to
  // anything other than the exact string 'production') would silently seal real,
  // legally-binding documents with the public cert. A missing cert must fail
  // loudly; the dev example cert is available only behind an explicit opt-in.
  if (env('NEXT_PRIVATE_ALLOW_DEV_CERT') === '1') {
    return fs.readFileSync('./example/cert.p12');
  }

  throw new Error('No certificate found for local signing');
};

export const createLocalSigner = async () => {
  const p12 = loadP12();

  return await P12Signer.create(p12, env('NEXT_PRIVATE_SIGNING_PASSPHRASE') || '', {
    buildChain: true,
  });
};
