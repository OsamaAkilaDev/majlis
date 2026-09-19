'use client';

import { PencilSimple } from '@phosphor-icons/react/ssr';
import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/cn';
import { ICON_WEIGHT } from '@/lib/icons';

export interface Option {
  value: string;
  label: string;
}

/**
 * A value that reads as itself until somebody edits it. Hovering lifts it,
 * pressing it turns it into the control it always was; Escape puts the value
 * back and Enter commits it to the draft, which the save bar then sends.
 *
 * Not a form field with a label above it: the club profile IS the club page,
 * and a page that reads one way and edits another is two screens to keep in
 * agreement. The accessible name comes from `label`, which is why nothing
 * visible has to say it.
 */
export function InlineEdit({
  label,
  value,
  onCommit,
  mode = 'text',
  options,
  editable,
  dirty,
  error,
  className,
  display,
}: {
  label: string;
  value: string;
  onCommit: (next: string) => void;
  mode?: 'text' | 'area' | 'select';
  options?: Option[];
  /** False renders the value as plain text: this viewer cannot write it. */
  editable: boolean;
  dirty?: boolean;
  error?: string | undefined;
  className?: string;
  /** What to show when the raw value is not what a reader should see. */
  display?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  // A value saved or discarded elsewhere has to land here too, or the next
  // edit starts from what this control still happens to be holding.
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (!editing) return;
    ref.current?.focus();
    ref.current?.select();
  }, [editing]);

  const shown = display ?? value;

  if (!editable) {
    return <span className={cn('text-ink', className)}>{shown}</span>;
  }

  function commit(next: string) {
    setEditing(false);
    if (next !== value) onCommit(next);
  }

  function cancel() {
    setDraft(value);
    setEditing(false);
  }

  // A select has no editing state of its own: it opens, it closes, it commits.
  if (mode === 'select') {
    return (
      <Marker dirty={dirty} error={error} className={className}>
        <Select value={value} onValueChange={onCommit}>
          <SelectTrigger
            aria-label={label}
            aria-invalid={error ? true : undefined}
            className="h-auto border-transparent bg-transparent px-1.5 py-0.5 [font:inherit] text-inherit shadow-none hover:bg-surface-2 data-[state=open]:bg-surface"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(options ?? []).map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Marker>
    );
  }

  if (editing) {
    const shared = {
      ref: ref as never,
      value: draft,
      'aria-label': label,
      'aria-invalid': error ? true : undefined,
      onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
      onBlur: () => commit(draft),
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          cancel();
        }
        if (e.key === 'Enter' && mode !== 'area') {
          e.preventDefault();
          commit(draft);
        }
      },
    };

    return (
      <Marker dirty={dirty} error={error} className={className}>
        {mode === 'area' ? (
          <Textarea {...shared} rows={5} className="[font:inherit] text-inherit" />
        ) : (
          <Input {...shared} className="h-auto px-1.5 py-0.5 [font:inherit] text-inherit" />
        )}
      </Marker>
    );
  }

  return (
    <Marker dirty={dirty} error={error} className={className}>
      <button
        type="button"
        aria-label={`${label}: ${shown}`}
        onClick={() => setEditing(true)}
        className="group/edit flex w-full items-start gap-1.5 rounded-control px-1.5 py-0.5 text-left [font:inherit] text-inherit transition-colors duration-(--dur-fast) ease-(--ease-out) hover:bg-surface-2"
      >
        <span className={cn('min-w-0 whitespace-pre-line', !shown && 'text-ink-3')}>
          {shown || `No ${label.toLowerCase()}`}
        </span>
        <PencilSimple
          size={14}
          weight={ICON_WEIGHT}
          aria-hidden
          className="mt-1 shrink-0 text-ink-3 opacity-0 transition-opacity duration-(--dur-fast) group-hover/edit:opacity-100"
        />
      </button>
    </Marker>
  );
}

/** The unsaved dot, and the field's own refusal if the API named it. */
function Marker({
  dirty,
  error,
  className,
  children,
}: {
  dirty?: boolean;
  error?: string | undefined;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span className={cn('relative block', className)}>
      {dirty ? (
        <span
          aria-hidden
          className="absolute top-2.5 -left-2.5 size-1.5 rounded-full bg-warn-fg"
        />
      ) : null}
      {children}
      {error ? (
        <span role="alert" className="mt-1 block px-1.5 text-sm text-bad-fg">
          {error}
        </span>
      ) : null}
    </span>
  );
}
