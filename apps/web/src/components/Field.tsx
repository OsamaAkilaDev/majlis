'use client';

import { CircleAlert } from 'lucide-react';
import { cloneElement, useId, type ReactElement, type ReactNode } from 'react';

export function Field({
  label,
  error,
  constraint,
  children,
}: {
  label: string;
  error?: string | undefined;
  /** Sits on the label row, not as a sentence below the control. */
  constraint?: ReactNode;
  children: ReactElement<{ id?: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }>;
}) {
  const id = useId();
  const errorId = `${id}-error`;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-sm font-semibold text-ink">
          {label}
        </label>
        {constraint}
      </div>
      {cloneElement(children, {
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': error ? errorId : undefined,
      })}
      {error ? (
        <p id={errorId} className="flex items-center gap-1.5 text-sm text-bad-fg">
          <CircleAlert className="size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
    </div>
  );
}
