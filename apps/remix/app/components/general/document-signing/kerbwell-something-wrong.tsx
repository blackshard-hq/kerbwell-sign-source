import { cn } from '@documenso/ui/lib/utils';
import { Button } from '@documenso/ui/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@documenso/ui/primitives/dialog';
import { BanIcon, FileTextIcon, MessageCircleQuestionIcon, UserXIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { useKerbwellGateSigning } from '../kerbwell/gate-signing-context';
import { DocumentSigningRejectDialog } from './document-signing-reject-dialog';

export type KerbwellSomethingWrongProps = {
  documentId: number;
  documentTitle: string;
  token: string;
  /** `panel` lists the actions in place (desktop sidebar); `button` opens them in a dialog (phone bar). */
  variant: 'panel' | 'button';
  className?: string;
};

type Action = {
  key: 'ask' | 'decline' | 'wrong-person' | 'paper';
  label: string;
  icon: ReactNode;
};

const ACTIONS: Action[] = [
  { key: 'ask', label: 'Ask the agent', icon: <MessageCircleQuestionIcon className="h-5 w-5" aria-hidden /> },
  { key: 'decline', label: 'Decline with a reason', icon: <BanIcon className="h-5 w-5" aria-hidden /> },
  { key: 'wrong-person', label: 'I am the wrong person', icon: <UserXIcon className="h-5 w-5" aria-hidden /> },
  { key: 'paper', label: 'Request paper', icon: <FileTextIcon className="h-5 w-5" aria-hidden /> },
];

const actionClass = 'min-h-11 w-full justify-start gap-3 text-left text-foreground';

/**
 * Kerbwell "Something wrong?" (fork addition). Behind a gate session the signer can always reach
 * the gate's actions: Ask the agent, Decline with a reason, Wrong person and Request paper. With
 * NEXT_PRIVATE_KERBWELL_GATE_ACTIONS_URL set they link to the portal, which records the request and
 * tells the agent. Without it, Ask the agent mails the agent (the envelope's reply-to) and the
 * other three use the fork's own decline, with the reason prefilled, so the request still reaches
 * the agent through the DOCUMENT_REJECTED webhook. Renders nothing when the gate is off.
 */
export const KerbwellSomethingWrong = ({
  documentId,
  documentTitle,
  token,
  variant,
  className,
}: KerbwellSomethingWrongProps) => {
  const gate = useKerbwellGateSigning();

  if (!gate) {
    return null;
  }

  const renderAction = (action: Action) => {
    const portalLink = gate.actions?.[action.key];

    if (portalLink) {
      return (
        <Button key={action.key} asChild variant="ghost" className={actionClass}>
          <a href={portalLink} data-testid={`kw-action-${action.key}`}>
            {action.icon}
            {action.label}
          </a>
        </Button>
      );
    }

    if (action.key === 'ask') {
      if (!gate.agentEmail) {
        return null;
      }

      const subject = encodeURIComponent(`Question about ${documentTitle}`);

      return (
        <Button key={action.key} asChild variant="ghost" className={actionClass}>
          <a href={`mailto:${gate.agentEmail}?subject=${subject}`} data-testid="kw-action-ask">
            {action.icon}
            {action.label}
          </a>
        </Button>
      );
    }

    const preset = {
      decline: { title: 'Decline to sign', reason: '' },
      'wrong-person': { title: 'Wrong person', reason: 'Wrong person: this document is not meant for me.' },
      paper: { title: 'Request paper', reason: 'Paper requested: I would like a paper copy to sign instead.' },
    }[action.key];

    return (
      <DocumentSigningRejectDialog
        key={action.key}
        documentId={documentId}
        token={token}
        title={preset.title}
        defaultReason={preset.reason}
        trigger={
          <Button type="button" variant="ghost" className={actionClass} data-testid={`kw-action-${action.key}`}>
            {action.icon}
            {action.label}
          </Button>
        }
      />
    );
  };

  const list = (
    <nav aria-label="Something wrong?" className="flex flex-col gap-1">
      {ACTIONS.map(renderAction)}
    </nav>
  );

  if (variant === 'panel') {
    return (
      <section className={cn('space-y-2', className)} data-testid="kw-something-wrong-panel">
        <h4 className="font-semibold text-foreground text-sm">Something wrong?</h4>
        {list}
      </section>
    );
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn('min-h-11 whitespace-nowrap px-3 text-foreground', className)}
          data-testid="kw-something-wrong"
        >
          Something wrong?
        </Button>
      </DialogTrigger>

      <DialogContent position="end">
        <DialogHeader>
          <DialogTitle>Something wrong?</DialogTitle>
          <DialogDescription className="text-foreground/80">
            Nothing is signed until you tap Sign agreement.
          </DialogDescription>
        </DialogHeader>

        {list}
      </DialogContent>
    </Dialog>
  );
};
