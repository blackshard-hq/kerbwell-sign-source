/**
 * We need to double wrap the PDFViewer to avoid the following errors:
 *
 * 1. Lazy prevents the pdfjs worker from being bundled
 * 2. onMount guard prevents "Worker not defined"
 */

import { cn } from '@documenso/ui/lib/utils';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker?url';
import { lazy, Suspense, useEffect, useState } from 'react';

import type { PDFViewerProps } from './pdf-viewer';
import { PdfViewerLoadingState } from './pdf-viewer-states';

const loadPdfViewer = async () => import('./pdf-viewer');

/**
 * Start fetching the viewer chunk and the pdf.js worker as soon as this module runs in the
 * browser, not after hydration and a render (fork change, Kerbwell Sign). On a phone the three
 * downloads otherwise run one after another and hold back the document, the page's largest paint.
 * The worker is warmed into the HTTP cache (its URL is hashed and served immutable), so pdf.js's
 * own request for it is a cache hit.
 */
if (typeof window !== 'undefined') {
  void loadPdfViewer();
  void fetch(pdfjsWorkerUrl, { credentials: 'same-origin' }).catch(() => undefined);
}

const PDFViewer = lazy(loadPdfViewer);

export default function PDFViewerLazy(props: PDFViewerProps) {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const fallback = (
    <div className={cn('h-full w-full', props.className)}>
      <PdfViewerLoadingState />
    </div>
  );

  if (!isClient) {
    return fallback;
  }

  return <Suspense fallback={fallback}>{PDFViewer && <PDFViewer {...props} />}</Suspense>;
}
