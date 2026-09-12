'use client';

import type { UserSearchItem } from '@majlis/contracts';
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
import { UserPicker } from '@/components/UserPicker';
import { ProblemError } from '@/lib/api';

/**
 * Pick a person, send it. The three screens that do this differ only in their
 * trigger, their wording and whether they carry an extra field, so the state
 * they all got wrong the same way (reset the picker and the error on close,
 * hold the submit button while in flight) lives here once.
 *
 * `children` renders between the picker and the error, for a caller that needs
 * a second field; that field's state stays with the caller, which is also what
 * closes over it in `onSubmit`.
 */
export function UserPickerDialog({
  trigger,
  title,
  confirmLabel,
  exclude,
  clubId,
  children,
  onSubmit,
}: {
  trigger: ReactNode;
  title: string;
  confirmLabel: string;
  exclude?: string[];
  /** Present on a club console, absent on an Admin screen. See UserPicker. */
  clubId?: string;
  children?: ReactNode;
  onSubmit: (user: UserSearchItem) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<UserSearchItem | null>(null);
  const [error, setError] = useState<ProblemError | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    if (!picked) return;
    setPending(true);
    setError(null);
    try {
      await onSubmit(picked);
      setOpen(false);
      setPicked(null);
    } catch (err) {
      if (err instanceof ProblemError) setError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setError(null);
          setPicked(null);
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <UserPicker value={picked} onChange={setPicked} exclude={exclude ?? []} clubId={clubId} />
        {children}
        {error ? <p className="text-sm text-bad-fg">{error.detail ?? error.title}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !picked}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
