import { Button } from '@documenso/ui/primitives/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@documenso/ui/primitives/dialog';
import { SignaturePad } from '@documenso/ui/primitives/signature-pad';
import { Trans } from '@lingui/react/macro';
import { useState } from 'react';
import { createCallable } from 'react-call';

import { DocumentSigningDisclosure } from '../general/document-signing/document-signing-disclosure';
import { isKerbwellUploadAllowed, useKerbwellGateSigning } from '../general/kerbwell/gate-signing-context';

export type SignFieldSignatureDialogProps = {
  initialSignature?: string;
  fullName?: string;
  typedSignatureEnabled?: boolean;
  uploadSignatureEnabled?: boolean;
  drawSignatureEnabled?: boolean;
};

export const SignFieldSignatureDialog = createCallable<SignFieldSignatureDialogProps, string | null>(
  ({ call, fullName, typedSignatureEnabled, uploadSignatureEnabled, drawSignatureEnabled, initialSignature }) => {
    const [localSignature, setLocalSignature] = useState(initialSignature);

    // Kerbwell: behind a gate session the typed signature opens first, filled with the CDD legal
    // name, so it is adopted with one tap. Draw stays an equal option; upload is never offered on
    // an agency agreement.
    const gate = useKerbwellGateSigning();
    const name = gate?.legalName || fullName;

    return (
      <Dialog open={true} onOpenChange={(value) => (!value ? call.end(null) : null)}>
        <DialogContent position="center">
          <div>
            <DialogHeader>
              <DialogTitle>{gate ? <Trans>Your signature</Trans> : <Trans>Sign Signature Field</Trans>}</DialogTitle>
            </DialogHeader>

            <SignaturePad
              fullName={name}
              value={localSignature ?? ''}
              onChange={({ value }) => setLocalSignature(value)}
              typedSignatureEnabled={typedSignatureEnabled}
              uploadSignatureEnabled={isKerbwellUploadAllowed(gate, uploadSignatureEnabled)}
              drawSignatureEnabled={drawSignatureEnabled}
              defaultTab={gate?.legalName ? 'text' : undefined}
            />
          </div>

          <DocumentSigningDisclosure />

          <DialogFooter>
            <Button type="button" variant="secondary" className="min-h-11" onClick={() => call.end(null)}>
              <Trans>Cancel</Trans>
            </Button>

            <Button
              type="button"
              className="min-h-11"
              data-testid="signature-adopt"
              disabled={!localSignature}
              onClick={() => call.end(localSignature || null)}
            >
              {gate ? <Trans>Adopt signature</Trans> : <Trans>Sign</Trans>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  },
);
