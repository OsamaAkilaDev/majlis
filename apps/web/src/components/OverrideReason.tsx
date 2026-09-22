'use client';

import { Field } from '@/components/Field';
import { Input } from '@/components/ui/input';

/**
 * Spec 6.1: an Admin holding no role in the club records why they intervened,
 * and the API refuses the action without it. One control per set of actions it
 * is carried by, which `label` names when a screen holds two such sets.
 */
export function OverrideReason({
  value,
  onChange,
  label = 'Override reason',
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  return (
    <Field label={label}>
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
