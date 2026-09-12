'use client';

import { Field } from '@/components/Field';
import { Input } from '@/components/ui/input';

/**
 * Spec 6.1: an Admin holding no role in the club records why they intervened,
 * and the API refuses the action without it. One control per console screen,
 * carried by every action taken on that screen.
 */
export function OverrideReason({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label="Override reason">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        maxLength={500}
        className="sm:max-w-md"
      />
    </Field>
  );
}
