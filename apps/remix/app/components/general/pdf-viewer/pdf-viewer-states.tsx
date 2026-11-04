import { Spinner } from '@documenso/ui/primitives/spinner';
import { Trans } from '@lingui/react/macro';

export const PdfViewerLoadingState = () => {
  return (
    <div className="flex h-[80vh] max-h-[60rem] w-full flex-col items-center justify-center overflow-hidden opacity-50">
      <Spinner />
    </div>
  );
};

/**
 * The server's image of the first page, shown while the viewer loads (fork addition, Kerbwell
 * Sign). In the server-rendered HTML it is the page's largest paint, so a phone shows the document
 * before pdf.js has downloaded. Decorative: the viewer's own page replaces it.
 */
export const PdfViewerPoster = ({ src }: { src: string }) => {
  return (
    <div className="w-full overflow-hidden rounded border border-border bg-white">
      <img
        src={src}
        alt=""
        width={800}
        height={1131}
        fetchPriority="high"
        decoding="async"
        draggable={false}
        className="block h-auto w-full"
        data-testid="pdf-viewer-poster"
      />
    </div>
  );
};

export const PdfViewerErrorState = () => {
  return (
    <div className="flex h-[80vh] max-h-[60rem] flex-col items-center justify-center bg-white/50 dark:bg-background">
      <div className="text-center text-muted-foreground">
        <p>
          <Trans>Something went wrong while loading the document.</Trans>
        </p>
        <p className="mt-1 text-sm">
          <Trans>Please try again or contact our support.</Trans>
        </p>
      </div>
    </div>
  );
};
