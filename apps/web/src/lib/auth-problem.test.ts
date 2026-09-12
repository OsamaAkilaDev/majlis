import { describe, expect, it } from 'vitest';
import { ProblemError } from '@/lib/api';
import { routeProblem } from '@/lib/auth-problem';

const problem = (init: ConstructorParameters<typeof ProblemError>[0]) => new ProblemError(init);

describe('routeProblem', () => {
  it('puts each validation error on its own control', () => {
    const routed = routeProblem(
      'signup',
      problem({
        status: 422,
        title: 'Unprocessable Entity',
        errors: [
          { path: 'email', message: 'Invalid email address.' },
          { path: 'password', message: 'Password must be at least 12 characters.' },
        ],
      }),
      null,
    );

    // Catches an implementation that collapses every error onto the first
    // field, or onto the form, which reads as one failure instead of two.
    expect(routed.fields).toEqual({
      email: 'Invalid email address.',
      password: 'Password must be at least 12 characters.',
    });
    expect(routed.form).toBeNull();
  });

  it('reports a 401 on the password field in the API words', () => {
    const routed = routeProblem(
      'login',
      problem({ status: 401, title: 'Unauthorized', detail: 'Email or password is incorrect.' }),
      null,
    );

    // Catches a client that substitutes its own wording, which then drifts
    // from the server the moment either side is reworded.
    expect(routed.fields).toEqual({ password: 'Email or password is incorrect.' });
    expect(routed.form).toBeNull();
  });

  it('reports a 409 on the email field, not the password field', () => {
    const routed = routeProblem(
      'signup',
      problem({ status: 409, title: 'Conflict', detail: 'An account with this email already exists.' }),
      null,
    );

    // Catches a status map that sends every credential failure to the password
    // field: the email is the one the user has to change here.
    expect(routed.fields).toEqual({ email: 'An account with this email already exists.' });
  });

  it('falls back to the title when a Problem carries no detail', () => {
    const routed = routeProblem('login', problem({ status: 502, title: 'Bad Gateway' }), null);
    expect(routed).toEqual({ fields: {}, form: 'Bad Gateway' });
  });

  it('surfaces a network failure with no response at all', () => {
    expect(routeProblem('login', null, 'Could not reach the server.')).toEqual({
      fields: {},
      form: 'Could not reach the server.',
    });
  });

  it('never drops an error whose path names no rendered control', () => {
    const routed = routeProblem(
      'login',
      problem({
        status: 422,
        title: 'Unprocessable Entity',
        errors: [{ path: 'fullName', message: 'Full name is required.' }],
      }),
      null,
    );

    // fullName is not rendered on the sign-in form. Catches a router that keys
    // only off known paths and leaves the submit looking like it did nothing.
    expect(routed.fields).toEqual({});
    expect(routed.form).toBe('Full name is required.');
  });

  it('routes a status the form cannot map to any control to the form', () => {
    const routed = routeProblem(
      'signup',
      problem({ status: 500, title: 'Internal Server Error', detail: 'Something went wrong.' }),
      null,
    );
    expect(routed).toEqual({ fields: {}, form: 'Something went wrong.' });
  });
});
