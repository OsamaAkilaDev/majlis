'use client';

import { ADMIN_ALREADY_EXISTS, type SessionUser } from '@majlis/contracts';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { PasswordRule } from '@/components/auth/AuthForm';
import { Field } from '@/components/Field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiFetch, ProblemError } from '@/lib/api';
import { routeProblem } from '@/lib/auth-problem';
import { BRAND } from '@/lib/brand';
import { landingFor } from '@/lib/routing';

const NO_RESPONSE = 'Could not reach the server. Check your connection and try again.';

/**
 * Creates the platform's first admin. Reachable only while there is none:
 * the page that renders this redirects to /login otherwise, and the API
 * answers 409 regardless of what this form sends.
 *
 * Not a third mode on AuthForm. The heading, the submit label, the absent
 * footer links and the conflict handling below all differ, and threading
 * four more branches through the form that every student signs in with, to
 * serve a screen shown once in the life of a deployment, is a worse trade
 * than one small component that reuses the same parts.
 */
export function SetupAdminForm() {
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
      const user = await apiFetch<SessionUser>('/auth/bootstrap', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      });
      router.replace(landingFor(user));
      router.refresh();
    } catch (err) {
      if (err instanceof ProblemError) {
        // Somebody claimed the admin account between this page rendering and
        // this submit. The screen is now obsolete rather than wrong, so it
        // goes away instead of explaining itself: /login is where a visitor
        // with no account belongs. The OTHER 409 this route answers (the
        // email is taken) is a fixable mistake and stays on the form.
        if (err.status === 409 && err.detail === ADMIN_ALREADY_EXISTS) {
          router.replace('/login');
          return;
        }
        setProblem(err);
      } else setNetworkError(NO_RESPONSE);
    } finally {
      setPending(false);
    }
  }

  const { fields, form } = routeProblem('setup', problem, networkError);

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      <h1 className="font-display text-display text-ink">{BRAND.product}</h1>

      <Field label="Full name" error={fields.fullName}>
        <Input name="fullName" autoComplete="name" required className="h-11" />
      </Field>

      <Field label="University email" error={fields.email}>
        <Input name="email" type="email" autoComplete="email" required className="h-11" />
      </Field>

      <Field
        label="Password"
        error={fields.password}
        constraint={<PasswordRule password={password} />}
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
        Create admin account
      </Button>
    </form>
  );
}
