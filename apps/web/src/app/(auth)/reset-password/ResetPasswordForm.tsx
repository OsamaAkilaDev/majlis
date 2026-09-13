'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { PasswordRule } from '@/components/auth/AuthForm';
import { Field } from '@/components/Field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiFetch, ProblemError } from '@/lib/api';
import { routeProblem } from '@/lib/auth-problem';
import { BRAND } from '@/lib/brand';

const NO_RESPONSE = 'Could not reach the server. Check your connection and try again.';

export function ResetPasswordForm({ initialToken }: { initialToken: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<ProblemError | null>(null);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [token, setToken] = useState(initialToken);
  const [password, setPassword] = useState('');

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setProblem(null);
    setNetworkError(null);

    try {
      await apiFetch('/auth/reset-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      // The reset revoked every session this account had, so there is nothing
      // to land on but the sign-in form.
      router.replace('/login');
      router.refresh();
    } catch (err) {
      if (err instanceof ProblemError) setProblem(err);
      else setNetworkError(NO_RESPONSE);
    } finally {
      setPending(false);
    }
  }

  const { fields, form } = routeProblem('reset', problem, networkError);

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      <h1 className="font-display text-display text-ink">{BRAND.product}</h1>

      {/* Shown, not hidden: the link carries the token in the URL, and with no
          mail transport configured a pasted token is the only way through. */}
      <Field label="Reset token" error={fields.token}>
        <Input
          name="token"
          required
          className="h-11"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </Field>

      <Field
        label="New password"
        error={fields.password}
        constraint={<PasswordRule length={password.length} />}
      >
        <Input
          name="password"
          type="password"
          autoComplete="new-password"
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
        Set password
      </Button>

      <Link href="/login" className="self-start text-sm text-primary underline underline-offset-4">
        Sign in
      </Link>
    </form>
  );
}
