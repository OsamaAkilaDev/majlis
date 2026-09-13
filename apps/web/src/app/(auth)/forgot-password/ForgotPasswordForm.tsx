'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Field } from '@/components/Field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiFetch, ProblemError } from '@/lib/api';
import { routeProblem } from '@/lib/auth-problem';
import { BRAND } from '@/lib/brand';

const NO_RESPONSE = 'Could not reach the server. Check your connection and try again.';

/**
 * The one thing this screen ever says on success, whether or not the address
 * resolves. A different answer for a real address would make the endpoint an
 * account-existence oracle, and the API answers 202 either way precisely so
 * this screen has nothing else to render.
 */
const SENT = 'If that address has an account, a reset link is on its way.';

export function ForgotPasswordForm() {
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState<ProblemError | null>(null);
  const [networkError, setNetworkError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setProblem(null);
    setNetworkError(null);

    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await apiFetch('/auth/forgot-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      });
      setSent(true);
    } catch (err) {
      if (err instanceof ProblemError) setProblem(err);
      else setNetworkError(NO_RESPONSE);
    } finally {
      setPending(false);
    }
  }

  const { fields, form } = routeProblem('forgot', problem, networkError);

  if (sent) {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="font-display text-display text-ink">Check your email</h1>
        <p role="status" className="text-sm text-ink-2">
          {SENT}
        </p>
        <Button asChild size="lg" className="h-11">
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      <h1 className="font-display text-display text-ink">{BRAND.product}</h1>

      <Field label="University email" error={fields.email}>
        <Input name="email" type="email" autoComplete="email" required className="h-11" />
      </Field>

      {form ? (
        <p role="alert" className="rounded-control bg-bad-soft px-3 py-2 text-sm text-bad-fg">
          {form}
        </p>
      ) : null}

      <Button type="submit" size="lg" disabled={pending} className="h-11">
        Send reset link
      </Button>

      <Link href="/login" className="self-start text-sm text-primary underline underline-offset-4">
        Sign in
      </Link>
    </form>
  );
}
