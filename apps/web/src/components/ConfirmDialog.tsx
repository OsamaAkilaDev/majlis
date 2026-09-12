'use client';

import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Field } from '@/components/Field';
import { Textarea } from '@/components/ui/textarea';
import { ProblemError } from '@/lib/api';

/**
 * One confirm-and-act dialog, shared by every destructive or state-changing
 * control: delete, suspend/archive, end an appointment, reject a request,
 * remove a member, leave a club. `reason` controls whether it carries a
 * reason field at all, since the API requires one on some actions and
 * accepts none on others.
 */
export function ConfirmDialog({
  trigger,
  title,
  confirmLabel = 'Confirm',
  destructive,
  reason = 'none',
  onConfirm,
}: {
  trigger: ReactNode;
  title: string;
  confirmLabel?: string;
  destructive?: boolean;
  reason?: 'none' | 'optional' | 'required';
  onConfirm: (reason?: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [reasonText, setReasonText] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setReasonText('');
      setError(null);
    }
  }

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      await onConfirm(reason === 'none' ? undefined : reasonText.trim() || undefined);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ProblemError ? (err.detail ?? err.title) : 'That action failed.');
    } finally {
      setPending(false);
    }
  }

  const blocked = pending || (reason === 'required' && reasonText.trim().length === 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {reason !== 'none' ? (
          <Field label="Reason">
            <Textarea
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
              required={reason === 'required'}
            />
          </Field>
        ) : null}

        {error ? <p className="text-sm text-bad-fg">{error}</p> : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant={destructive ? 'destructive' : 'default'} onClick={confirm} disabled={blocked}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
