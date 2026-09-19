'use client';

import type { SessionUser } from '@majlis/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Field } from '@/components/Field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiFetch, ProblemError } from '@/lib/api';
import { routeProblem } from '@/lib/auth-problem';
import { BRAND } from '@/lib/brand';
import { cn } from '@/lib/cn';
import { passwordStrength, STRENGTH_STEPS } from '@/lib/password-strength';
import { landingFor } from '@/lib/routing';

export const PASSWORD_MISMATCH = 'Both passwords must match.';
const NO_RESPONSE = 'Could not reach the server. Check your connection and try again.';

/**
 * The label carries two different things by design: below the minimum, the
 * rule, since nothing else would let the user submit; once met, the grade.
 * Exported for the reset and first-admin forms.
 */
export function PasswordRule({ password }: { password: string }) {
  const { score, label, met } = passwordStrength(password);
  // Weak and Fair are accepted by the API, so they must not read as errors.
  const tone = !met ? 'text-ink-2' : score <= 2 ? 'text-warn-fg' : 'text-primary';
  const fill = !met ? 'bg-border-control' : score <= 2 ? 'bg-warn-fg' : 'bg-primary';

  return (
    <span className="flex items-center gap-2">
      <span className="flex gap-0.5" aria-hidden>
        {Array.from({ length: STRENGTH_STEPS }, (_, i) => (
          <span
            key={i}
            className={cn(
              'h-1 w-3.5 rounded-full transition-colors duration-(--dur-fast) ease-(--ease-out)',
              i >= score ? 'bg-surface-2' : fill,
            )}
          />
        ))}
      </span>
      {/* Not aria-hidden, unlike the bars: this is the only form the meter
          takes for a screen reader. Polite, or typing is narrated per key. */}
      <span
        role="status"
        aria-live="polite"
        className={cn('text-label tabular font-medium', tone)}
      >
        {label}
      </span>
    </span>
  );
}

export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<ProblemError | null>(null);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [mismatch, setMismatch] = useState<string | null>(null);
  const signup = mode === 'signup';

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // The API has no second password to compare against and never will, so a
    // typo that gets through creates an account nobody can sign in to.
    if (signup && password !== confirm) {
      setMismatch(PASSWORD_MISMATCH);
      return;
    }

    setPending(true);
    setProblem(null);
    setNetworkError(null);

    // confirm never leaves the browser: the contract has no field for it, so
    // sending it would lean on Zod stripping unknown keys to stay correct.
    const body = new FormData(event.currentTarget);
    body.delete('confirm');
    const data = Object.fromEntries(body);
    try {
      const user = await apiFetch<SessionUser>(`/auth/${mode}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      });
      router.replace(landingFor(user));
      router.refresh();
    } catch (err) {
      if (err instanceof ProblemError) setProblem(err);
      else setNetworkError(NO_RESPONSE);
    } finally {
      setPending(false);
    }
  }

  const { fields, form } = routeProblem(mode, problem, networkError);

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      <h1 className="font-display text-display text-ink">{BRAND.product}</h1>

      {signup ? (
        <Field label="Full name" error={fields.fullName}>
          <Input name="fullName" autoComplete="name" required className="h-11" />
        </Field>
      ) : null}

      <Field label="University email" error={fields.email}>
        <Input name="email" type="email" autoComplete="email" required className="h-11" />
      </Field>

      <Field
        label="Password"
        error={fields.password}
        constraint={signup ? <PasswordRule password={password} /> : undefined}
      >
        <Input
          name="password"
          type="password"
          autoComplete={signup ? 'new-password' : 'current-password'}
          required
          className="h-11"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setMismatch(null);
          }}
        />
      </Field>

      {signup ? (
        <Field label="Confirm password" error={mismatch ?? undefined}>
          <Input
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
            className="h-11"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              // Cleared on edit, never re-checked: that reports a mismatch
              // against a value still being typed.
              setMismatch(null);
            }}
          />
        </Field>
      ) : null}

      {form ? (
        <p role="alert" className="rounded-control bg-bad-soft px-3 py-2 text-sm text-bad-fg">
          {form}
        </p>
      ) : null}

      <Button type="submit" size="lg" disabled={pending} className="h-11">
        {signup ? 'Create account' : 'Sign in'}
      </Button>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={signup ? '/login' : '/signup'}
          className="text-sm text-primary underline underline-offset-4"
        >
          {signup ? 'Sign in' : 'Create account'}
        </Link>
        {signup ? null : (
          <Link href="/forgot-password" className="text-sm text-ink-2 underline underline-offset-4">
            Forgot password
          </Link>
        )}
      </div>
    </form>
  );
}
