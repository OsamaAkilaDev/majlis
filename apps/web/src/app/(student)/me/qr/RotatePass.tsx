'use client';

import { ArrowsClockwise } from '@phosphor-icons/react/ssr';
import { useRouter } from 'next/navigation';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { rotateQrPass } from '@/lib/attendance';
import { ICON_WEIGHT } from '@/lib/icons';

/**
 * Rotation is destructive in a way nothing else on the student shell is: the
 * version is signed into the payload, so every image already printed, saved or
 * screenshotted stops verifying the moment this returns. Hence the confirm.
 */
export function RotatePass() {
  const router = useRouter();

  return (
    <ConfirmDialog
      title="Replace this pass and stop every saved copy working?"
      confirmLabel="Replace pass"
      destructive
      trigger={
        <Button variant="outline" className="h-11 px-4">
          <ArrowsClockwise size={16} weight={ICON_WEIGHT} aria-hidden />
          Replace pass
        </Button>
      }
      onConfirm={async () => {
        await rotateQrPass();
        router.refresh();
      }}
    />
  );
}
