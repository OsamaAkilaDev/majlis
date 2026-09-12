import { describe, expect, it } from 'vitest';
import { inviteTeamMemberBodySchema } from './index';

describe('inviteTeamMemberBodySchema', () => {
  it('rejects LEAD, which has its own Admin-only route', () => {
    // Catches `role: clubRoleSchema`. A Lead could otherwise invite a
    // second Lead through the team route, which spec 6.1 reserves to Admin.
    const body = { userId: '01936c7e-0000-7000-8000-000000000000', role: 'LEAD' };
    expect(inviteTeamMemberBodySchema.safeParse(body).success).toBe(false);
  });

  it('accepts the four non-Lead roles', () => {
    for (const role of ['VICE_LEAD', 'MARKETING', 'CTO', 'OPERATIONS']) {
      const body = { userId: '01936c7e-0000-7000-8000-000000000000', role };
      expect(inviteTeamMemberBodySchema.safeParse(body).success).toBe(true);
    }
  });
});
