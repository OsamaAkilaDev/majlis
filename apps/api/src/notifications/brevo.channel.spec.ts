import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrevoChannel } from './brevo.channel';
import type { DeliverableNotification, DeliveryOutcome } from './notification-channel';

const API_KEY = 'xkeysib-SUPERSECRETVALUE';

const NOTIFICATION: DeliverableNotification = {
  type: 'team.invited',
  payload: { clubName: 'Robotics', role: 'Operations' },
  recipientEmail: 'student@example.edu',
  recipientName: 'Sara',
};

function channel(from = 'Majlis <notifications@majlis.test>') {
  return new BrevoChannel(API_KEY, from, 'https://majlis.test');
}

function respondWith(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** The JSON body of the one request the channel made. */
function sentBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

function errorOf(outcome: DeliveryOutcome): string {
  return outcome.status === 'FAILED' ? outcome.error : '';
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('BrevoChannel', () => {
  it('posts the rendered email to Brevo and reports SENT', async () => {
    const fetchMock = respondWith(201, { messageId: '<abc@relay.brevo.com>' });

    await expect(channel().deliver(NOTIFICATION)).resolves.toEqual({ status: 'SENT' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(init.method).toBe('POST');
    // Brevo authenticates on `api-key`, not Authorization. A request sent
    // with the wrong header name is a 401 on every notification.
    expect(init.headers['api-key']).toBe(API_KEY);

    const body = sentBody(fetchMock);
    expect(body.to).toEqual([{ email: 'student@example.edu', name: 'Sara' }]);
    // The real templates render, so this also proves the channel passes
    // webOrigin and payload through rather than sending an empty shell.
    expect(String(body.subject)).toContain('Robotics');
    expect(String(body.htmlContent)).toContain('Robotics');
  });

  it('splits a "Name <address>" sender into the object Brevo expects', async () => {
    const fetchMock = respondWith(201, {});

    await channel().deliver(NOTIFICATION);

    // Catches a channel that passes BREVO_FROM straight through: Brevo 400s
    // "Majlis <notifications@majlis.test>" as an email address, on every send.
    expect(sentBody(fetchMock).sender).toEqual({ name: 'Majlis', email: 'notifications@majlis.test' });
  });

  it('sends a bare address with no display name', async () => {
    const fetchMock = respondWith(201, {});

    await channel('notifications@majlis.test').deliver(NOTIFICATION);

    // The other half of the parser: a regex that requires angle brackets
    // yields an empty email here and fails every send instead.
    expect(sentBody(fetchMock).sender).toEqual({ email: 'notifications@majlis.test' });
  });

  it('reports FAILED when Brevo rejects the send', async () => {
    respondWith(400, { code: 'invalid_parameter', message: 'Invalid sender address' });

    const outcome = await channel().deliver(NOTIFICATION);

    // fetch resolves for a 400 exactly as readily as for a 201. An
    // implementation that only catches a throw marks every rejected send
    // SENT, and a bounced address looks delivered to an Admin forever.
    expect(outcome.status).toBe('FAILED');
    expect(errorOf(outcome)).toContain('Invalid sender address');
  });

  it('reports FAILED rather than throwing when the request never completes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));

    // The sweep delivers a batch in a loop, so a throw here abandons every
    // notification queued behind this one.
    const outcome = await channel().deliver(NOTIFICATION);

    expect(outcome.status).toBe('FAILED');
    expect(errorOf(outcome)).toContain('ECONNRESET');
  });

  it('keeps the API key out of the error it stores', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(`connect failed, sent api-key ${API_KEY}`)));

    const outcome = await channel().deliver(NOTIFICATION);

    // A FAILED error is written to email_status and rendered to an Admin, so
    // it is a log surface like any other. Catches passing the cause's message
    // through verbatim.
    expect(outcome.status).toBe('FAILED');
    expect(JSON.stringify(outcome)).not.toContain('SUPERSECRETVALUE');
  });
});
