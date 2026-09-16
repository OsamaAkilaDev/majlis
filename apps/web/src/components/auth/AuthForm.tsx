'use client';

import type { SessionUser } from '@majlis/contracts';
import { PASSWORD_MIN } from '@majlis/contracts/constants';
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
import { landingFor } from '@/lib/routing';

const SEGMENTS = 4;
const NO_RESPONSE = 'Could not reach the server. Check your connection and try again.';

/**
 * The one rule that is invisible until submit, shown on the label instead.
 * Exported for the reset form, which sets a new password under the same rule.
 */
export function PasswordRule({ length }: { length: number }) {
  const met = length >= PASSWORD_MIN;
  const filled = Math.min(Math.ceil((length / PASSWORD_MIN) * SEGMENTS), SEGMENTS);

  return (
    <span className="flex items-center gap-2">
      <span className="flex gap-0.5" aria-hidden>
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <span
            key={i}
            className={cn(
              'h-1 w-3.5 rounded-full transition-colors duration-(--dur-fast) ease-(--ease-out)',
              i >= filled ? 'bg-surface-2' : met ? 'bg-primary' : 'bg-border-control',
            )}
          />
        ))}
      </span>
      <span className={cn('text-label tabular font-medium', met ? 'text-primary' : 'text-ink-2')}>
        {PASSWORD_MIN}+ characters
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

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setProblem(null);
    setNetworkError(null);

    const data = Object.fromEntries(new FormData(event.currentTarget));
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
  const signup = mode === 'signup';

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
        constraint={signup ? <PasswordRule length={password.length} /> : undefined}
      >
        <Input
          name="password"
          type="password"
          autoComplete={signup ? 'new-password' : 'current-password'}
          required
          className="h-11"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>

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
