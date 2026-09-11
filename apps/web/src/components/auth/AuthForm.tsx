'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/Field';
import { apiFetch, ProblemError } from '@/lib/api';
import { BRAND } from '@/lib/brand';
import { landingFor } from '@/lib/routing';
import type { SessionUser } from '@majlis/contracts';

export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<ProblemError | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setProblem(null);

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
      if (err instanceof ProblemError) {
        setProblem(err);
        if (err.errors.length === 0) toast.error(err.detail ?? err.title);
      } else {
        toast.error('Could not reach the server. Check your connection and try again.');
      }
    } finally {
      setPending(false);
    }
  }

  // A 401 from login carries no errors[], so surface it on the password field
  // where the user can act on it rather than in a toast they may miss.
  const passwordError =
    problem?.fieldError('password') ??
    (problem?.status === 401 ? 'That email and password do not match. Check them and try again.' : undefined);

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      <h1 className="font-display text-display text-ink">{BRAND.product}</h1>

      {mode === 'signup' ? (
        <Field label="Full name" error={problem?.fieldError('fullName')}>
          <Input name="fullName" autoComplete="name" required />
        </Field>
      ) : null}

      <Field label="University email" error={problem?.fieldError('email')}>
        <Input name="email" type="email" autoComplete="email" required />
      </Field>

      <Field label="Password" error={passwordError}>
        <Input
          name="password"
          type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          required
        />
      </Field>

      <Button type="submit" disabled={pending}>
        {mode === 'login' ? 'Sign in' : 'Create account'}
      </Button>
    </form>
  );
}
