import { hash } from '@node-rs/argon2';
import { ARGON2_OPTIONS } from '../src/auth/auth.service';
import { serialNumber, verificationCode } from '../src/certificates/certificate-codes';
import { PrismaClient, type Prisma } from '../src/generated/prisma/client';
import { pgAdapter } from '../src/prisma/pg-adapter';
import { assertSafeToSeed } from './seed';

/**
 * A populated university, for looking at real screens.
 *
 * Separate from `seed.ts` on purpose: that one owns the four personas and the
 * exact fixtures the e2e suite asserts against (capacity 1, a taken seat, a
 * closed club), and widening it would break those. This one only ever adds.
 *
 * Every write is either an upsert on a natural key or a create guarded by a
 * read of what is already there, so a second run writes nothing. Nothing is
 * ever deleted, and no row that this seed did not create is modified, with one
 * stated exception: accounts already in the database are given memberships and
 * one Vice Lead appointment, so whoever owns them can actually open the
 * screens. See `adoptExistingPeople`.
 *
 * Deterministic: one seeded PRNG drives every choice, so the same run produces
 * the same university and re-running is a no-op rather than a second copy.
 */

const SEED_PASSWORD = 'Passw0rd!';
const EMAIL_DOMAIN = 'uni.ac.ae';
const ACADEMIC_YEAR = '2026/2027';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const at = (msFromNow: number) => new Date(Date.now() + msFromNow);

/** mulberry32. Small, seeded, and stable across runs, which is what makes this
 *  seed idempotent rather than merely additive. */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- the people

const GIVEN = [
  'Layla', 'Omar', 'Sara', 'Yusuf', 'Mariam', 'Khalid', 'Noura', 'Hamdan',
  'Fatima', 'Rashid', 'Aisha', 'Tariq', 'Hind', 'Saeed', 'Reem', 'Majid',
  'Salma', 'Faisal', 'Dana', 'Nasser', 'Amal', 'Zayed', 'Lina', 'Hassan',
  'Shaikha', 'Adel', 'Rana', 'Bilal', 'Maryam', 'Idris', 'Nadia', 'Kareem',
  'Huda', 'Sultan', 'Yara', 'Waleed', 'Jana', 'Mansour', 'Leen', 'Ibrahim',
  'Ghaya', 'Anas', 'Alia', 'Rayan', 'Muna', 'Talal', 'Nour', 'Fahad',
  'Wafa', 'Marwan', 'Rima', 'Ziad', 'Batool', 'Hamza', 'Iman', 'Sami',
  'Dalia', 'Jamal', 'Rawan', 'Basel',
];

const FAMILY = [
  'Al Mansoori', 'Haddad', 'Khoury', 'Nasser', 'Rashid', 'Al Falasi',
  'Darwish', 'Al Suwaidi', 'Odeh', 'Barakat', 'Al Marri', 'Sharif',
  'Al Nuaimi', 'Zaman', 'Qassim', 'Al Hashimi', 'Fakhoury', 'Salem',
  'Al Ketbi', 'Mustafa',
];

interface Person {
  email: string;
  fullName: string;
  platformRole: 'STUDENT' | 'ADMIN';
}

/** 60 students and one faculty admin, built from the two name pools so the
 *  roster reads like a register rather than "Test User 41". */
function buildPeople(): Person[] {
  const seen = new Set<string>();
  const people: Person[] = [
    { email: `dean@${EMAIL_DOMAIN}`, fullName: 'Amal Al Suwaidi', platformRole: 'ADMIN' },
  ];
  seen.add(people[0]!.email);

  for (let i = 0; people.length < 61 && i < GIVEN.length * FAMILY.length; i++) {
    const given = GIVEN[i % GIVEN.length]!;
    const family = FAMILY[(i * 7 + Math.floor(i / GIVEN.length)) % FAMILY.length]!;
    const fullName = `${given} ${family}`;
    const email = `${fullName.toLowerCase().replace(/\s+/g, '.')}@${EMAIL_DOMAIN}`;
    if (seen.has(email)) continue;
    seen.add(email);
    people.push({ email, fullName, platformRole: 'STUDENT' });
  }

  return people;
}

// ----------------------------------------------------------- the departments

const DEPARTMENTS = [
  { code: 'ENG', name: 'Engineering', description: 'Mechanical, electrical and civil engineering.' },
  { code: 'CIT', name: 'Computing and Information Technology', description: 'Software, systems and data.' },
  { code: 'BUS', name: 'Business and Economics', description: 'Management, finance and economics.' },
  { code: 'HSS', name: 'Humanities and Social Sciences', description: 'Language, history, politics and law.' },
  { code: 'SCI', name: 'Natural Sciences', description: 'Physics, chemistry, biology and earth science.' },
  { code: 'HLT', name: 'Health Sciences', description: 'Medicine, nursing and public health.' },
] as const;

type DeptCode = (typeof DEPARTMENTS)[number]['code'];

// ----------------------------------------------------------------- the clubs

interface ClubPlan {
  slug: string;
  name: string;
  dept: DeptCode;
  category: string;
  policy: 'OPEN' | 'APPROVAL_REQUIRED' | 'INVITE_ONLY' | 'CLOSED';
  status?: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  about: string;
  venue: string;
  /** Titles cycled through the lifecycle arc below. At least six, so a club
   *  never shows the same event twice on one page. */
  events: [title: string, type: string][];
}

const CLUBS: ClubPlan[] = [
  {
    slug: 'robotics-society',
    name: 'Robotics Society',
    dept: 'ENG',
    category: 'Technology',
    policy: 'APPROVAL_REQUIRED',
    about:
      'We build autonomous ground and aerial robots, and we compete twice a year. Weekly build nights are open to anyone who turns up, whatever they already know.\n\nTools, components and lab access are provided. Bring a laptop if you have one.',
    venue: 'Engineering Building, Lab B2',
    events: [
      ['Drone Build Night', 'Workshop'],
      ['Line Follower Sprint', 'Competition'],
      ['PCB Design Clinic', 'Workshop'],
      ['Summer Robotics Showcase', 'Showcase'],
      ['Introduction to ROS 2', 'Workshop'],
      ['Arduino Fundamentals', 'Workshop'],
    ],
  },
  {
    slug: 'formula-student',
    name: 'Formula Student',
    dept: 'ENG',
    category: 'Motorsport',
    policy: 'APPROVAL_REQUIRED',
    about:
      'One car, one season, eighty people. We design, build and race a single-seater against universities across the region.\n\nThe team runs subgroups for chassis, powertrain, aerodynamics, electronics and operations.',
    venue: 'Engineering Building, Workshop 1',
    events: [
      ['Chassis Welding Induction', 'Training'],
      ['Aero Package Review', 'Review'],
      ['Test Day at Yas Marina', 'Competition'],
      ['Powertrain Teardown', 'Workshop'],
      ['Sponsor Evening', 'Networking'],
      ['Season Kickoff Briefing', 'Briefing'],
    ],
  },
  {
    slug: 'renewable-energy-lab',
    name: 'Renewable Energy Lab',
    dept: 'ENG',
    category: 'Sustainability',
    policy: 'OPEN',
    about:
      'Solar, storage and grid modelling, applied to the campus itself. Our rooftop array has been running since 2024 and every reading is open to members.',
    venue: 'Engineering Building, Roof Lab',
    events: [
      ['Rooftop Array Walkthrough', 'Site visit'],
      ['Battery Sizing Workshop', 'Workshop'],
      ['Grid Modelling with Python', 'Workshop'],
      ['Campus Energy Audit', 'Project'],
      ['Solar Car Challenge Briefing', 'Briefing'],
      ['Hydrogen Storage Seminar', 'Seminar'],
    ],
  },
  {
    slug: 'cybersecurity-guild',
    name: 'Cybersecurity Guild',
    dept: 'CIT',
    category: 'Security',
    policy: 'INVITE_ONLY',
    about:
      'Capture the flag, reverse engineering and defensive tooling. Membership is by invitation after a qualifying round, which runs at the start of each semester.',
    venue: 'IT Building, Secure Lab 3',
    events: [
      ['Qualifying CTF Round', 'Competition'],
      ['Binary Exploitation 101', 'Workshop'],
      ['Blue Team Tabletop', 'Exercise'],
      ['Regional CTF Finals', 'Competition'],
      ['Threat Intel Reading Group', 'Seminar'],
      ['Hardware Hacking Night', 'Workshop'],
    ],
  },
  {
    slug: 'ai-data-circle',
    name: 'AI and Data Circle',
    dept: 'CIT',
    category: 'Technology',
    policy: 'OPEN',
    about:
      'A reading group that ships. Every term we pick a paper, reproduce it, and publish the notebook.\n\nNo prior machine learning is assumed and the reading list starts from linear algebra.',
    venue: 'IT Building, Room 2.10',
    events: [
      ['Paper Reproduction Sprint', 'Project'],
      ['Transformers from Scratch', 'Workshop'],
      ['Data Ethics Panel', 'Panel'],
      ['Kaggle Weekend', 'Competition'],
      ['Vector Databases in Practice', 'Seminar'],
      ['Term Showcase', 'Showcase'],
    ],
  },
  {
    slug: 'game-dev-collective',
    name: 'Game Dev Collective',
    dept: 'CIT',
    category: 'Creative',
    policy: 'OPEN',
    about:
      'Artists, writers, designers and programmers building small games together. Four game jams a year and a public showcase each June.',
    venue: 'IT Building, Studio 1',
    events: [
      ['48 Hour Game Jam', 'Jam'],
      ['Pixel Art Intensive', 'Workshop'],
      ['Godot Fundamentals', 'Workshop'],
      ['Playtest Night', 'Social'],
      ['Sound Design for Games', 'Workshop'],
      ['Showcase and Awards', 'Showcase'],
    ],
  },
  {
    slug: 'entrepreneurship-hub',
    name: 'Entrepreneurship Hub',
    dept: 'BUS',
    category: 'Business',
    policy: 'OPEN',
    about:
      'From an idea on a napkin to a pitch that stands up. We run a nine-week programme each semester, ending in a demo day in front of real investors.',
    venue: 'Business School, Auditorium',
    events: [
      ['Demo Day', 'Showcase'],
      ['Customer Discovery Workshop', 'Workshop'],
      ['Pitch Clinic', 'Clinic'],
      ['Founder Fireside', 'Talk'],
      ['Unit Economics Bootcamp', 'Workshop'],
      ['Programme Kickoff', 'Briefing'],
    ],
  },
  {
    slug: 'investment-society',
    name: 'Investment Society',
    dept: 'BUS',
    category: 'Finance',
    policy: 'APPROVAL_REQUIRED',
    about:
      'A student-run portfolio with real, if modest, capital. Members present a thesis before anything is bought, and every position is reviewed in public.',
    venue: 'Business School, Trading Room',
    events: [
      ['Quarterly Portfolio Review', 'Review'],
      ['Valuation Bootcamp', 'Workshop'],
      ['Stock Pitch Competition', 'Competition'],
      ['Bloomberg Terminal Training', 'Training'],
      ['Macro Outlook Briefing', 'Briefing'],
      ['Alumni in Markets', 'Networking'],
    ],
  },
  {
    slug: 'marketing-club',
    name: 'Marketing Club',
    dept: 'BUS',
    category: 'Business',
    policy: 'OPEN',
    about:
      'Brand, content and campaign work for real clients, mostly campus societies who need a hand. Portfolio pieces, not coursework.',
    venue: 'Business School, Room 1.04',
    events: [
      ['Campaign Teardown', 'Workshop'],
      ['Brand Sprint for Societies', 'Project'],
      ['Content Shoot Day', 'Workshop'],
      ['Analytics for Marketers', 'Training'],
      ['Agency Visit', 'Site visit'],
      ['Portfolio Review Evening', 'Review'],
    ],
  },
  {
    slug: 'debate-union',
    name: 'Debate Union',
    dept: 'HSS',
    category: 'Public speaking',
    policy: 'APPROVAL_REQUIRED',
    about:
      'British Parliamentary format, trained weekly. We send two teams to the regional championship and host an open floor every fortnight.',
    venue: 'Humanities Building, Debating Chamber',
    events: [
      ['Open Floor Debate', 'Debate'],
      ['Novice Training Night', 'Training'],
      ['Regional Championship', 'Competition'],
      ['Adjudication Workshop', 'Workshop'],
      ['Inter-Faculty Showdown', 'Competition'],
      ['Rhetoric Masterclass', 'Masterclass'],
    ],
  },
  {
    slug: 'arabic-literature-circle',
    name: 'Arabic Literature Circle',
    dept: 'HSS',
    category: 'Literature',
    policy: 'OPEN',
    about:
      'Classical and contemporary Arabic writing, read closely and argued about warmly. Sessions run in Arabic; texts are provided in both scripts.',
    venue: 'Library, Reading Room 2',
    events: [
      ['Mahfouz Reading Night', 'Reading'],
      ['Poetry and Translation', 'Workshop'],
      ['Modern Gulf Fiction', 'Seminar'],
      ['Open Mic Evening', 'Social'],
      ['Manuscript Handling Session', 'Workshop'],
      ['Annual Literary Salon', 'Showcase'],
    ],
  },
  {
    slug: 'model-united-nations',
    name: 'Model United Nations',
    dept: 'HSS',
    category: 'Diplomacy',
    policy: 'APPROVAL_REQUIRED',
    about:
      'Committee simulation, position papers and a great deal of procedure. We host an internal conference in November and travel to two externals a year.',
    venue: 'Humanities Building, Conference Hall',
    events: [
      ['Internal Conference', 'Conference'],
      ['Position Paper Clinic', 'Clinic'],
      ['Rules of Procedure Training', 'Training'],
      ['Security Council Simulation', 'Simulation'],
      ['Delegate Selection Round', 'Selection'],
      ['Crisis Committee Night', 'Simulation'],
    ],
  },
  {
    slug: 'astronomy-society',
    name: 'Astronomy Society',
    dept: 'SCI',
    category: 'Science',
    policy: 'OPEN',
    about:
      'Two telescopes, a dark-sky site ninety minutes out, and a standing invitation to anyone who wants to look through them.',
    venue: 'Science Building, Observatory',
    events: [
      ['Desert Observation Night', 'Field trip'],
      ['Astrophotography Basics', 'Workshop'],
      ['Lunar Eclipse Viewing', 'Observation'],
      ['Telescope Maintenance Day', 'Workshop'],
      ['Cosmology Lecture', 'Lecture'],
      ['Planetarium Evening', 'Showcase'],
    ],
  },
  {
    slug: 'marine-conservation',
    name: 'Marine Conservation',
    dept: 'SCI',
    category: 'Environment',
    policy: 'OPEN',
    about:
      'Reef surveys, mangrove planting and beach transects along the coast. Dive certification is useful but not required for most of what we do.',
    venue: 'Science Building, Marine Lab',
    events: [
      ['Mangrove Planting Day', 'Field trip'],
      ['Reef Survey Training', 'Training'],
      ['Beach Transect Count', 'Field trip'],
      ['Marine Plastics Seminar', 'Seminar'],
      ['Coral Nursery Visit', 'Site visit'],
      ['Annual Coastal Cleanup', 'Volunteering'],
    ],
  },
  {
    slug: 'red-crescent-volunteers',
    name: 'Red Crescent Volunteers',
    dept: 'HLT',
    category: 'Volunteering',
    policy: 'OPEN',
    about:
      'First aid cover for campus events, blood drives twice a term, and a standing partnership with the local branch.',
    venue: 'Health Sciences Building, Skills Lab',
    events: [
      ['Campus Blood Drive', 'Volunteering'],
      ['First Aid Certification', 'Training'],
      ['Disaster Response Drill', 'Exercise'],
      ['Event Cover Briefing', 'Briefing'],
      ['CPR Refresher', 'Training'],
      ['Volunteer Recognition Evening', 'Social'],
    ],
  },
  {
    slug: 'public-health-forum',
    name: 'Public Health Forum',
    dept: 'HLT',
    category: 'Health',
    policy: 'CLOSED',
    about:
      'A seminar series on population health, currently paused to new members while the committee is rebuilt.',
    venue: 'Health Sciences Building, Seminar Room',
    events: [
      ['Epidemiology Journal Club', 'Seminar'],
      ['Health Policy Debate', 'Debate'],
      ['Field Epidemiology Talk', 'Talk'],
      ['Vaccination Outreach Day', 'Volunteering'],
      ['Statistics for Public Health', 'Workshop'],
      ['Annual Symposium', 'Conference'],
    ],
  },
  {
    slug: 'photography-club',
    name: 'Photography Club',
    dept: 'HSS',
    category: 'Creative',
    policy: 'OPEN',
    status: 'SUSPENDED',
    about: 'Darkroom, digital and everything between. Suspended pending a review of equipment handling.',
    venue: 'Humanities Building, Darkroom',
    events: [
      ['Golden Hour Walk', 'Field trip'],
      ['Darkroom Printing', 'Workshop'],
      ['Portraiture Lighting', 'Workshop'],
      ['Street Photography Ethics', 'Seminar'],
      ['Print Exhibition', 'Showcase'],
      ['Film Developing Night', 'Workshop'],
    ],
  },
  {
    slug: 'heritage-society',
    name: 'Heritage Society',
    dept: 'HSS',
    category: 'Culture',
    policy: 'CLOSED',
    status: 'ARCHIVED',
    about: 'Oral history and built heritage. Archived after its final committee graduated in 2025.',
    venue: 'Humanities Building, Room 0.12',
    events: [
      ['Oral History Recording', 'Project'],
      ['Old Town Walking Tour', 'Field trip'],
      ['Archive Handling Training', 'Training'],
      ['Heritage Photography', 'Workshop'],
      ['Closing Exhibition', 'Showcase'],
      ['Final General Meeting', 'Meeting'],
    ],
  },
];

/**
 * Where each of a club's events sits relative to now, and the state the
 * product would have left it in. Past events are stored COMPLETED or
 * CERTIFIED rather than PUBLISHED: the lazy lifecycle would have swept them
 * there on first read, and `eventsRun` counts the stored status.
 */
const ARC = [
  { days: -58, hours: 3, status: 'CERTIFIED', certificate: true },
  { days: -31, hours: 2, status: 'COMPLETED', certificate: false },
  { days: -11, hours: 4, status: 'COMPLETED', certificate: true },
  { days: 6, hours: 3, status: 'PUBLISHED', certificate: false },
  { days: 21, hours: 2, status: 'PUBLISHED', certificate: true },
  { days: 44, hours: 6, status: 'DRAFT', certificate: false },
] as const;

// ------------------------------------------------------------------ plumbing

/** Rows of `wanted` whose key is not already present, created in one
 *  statement. `skipDuplicates` is the backstop, not the plan: a partial unique
 *  index the read could not express still has to not blow up the whole batch. */
async function createMissing<T>(
  label: string,
  wanted: T[],
  create: (rows: T[]) => Promise<{ count: number }>,
): Promise<void> {
  if (wanted.length === 0) {
    console.error(`  ${label}: nothing to add`);
    return;
  }
  const { count } = await create(wanted);
  console.error(`  ${label}: +${count}`);
}

export async function seedDemo(prisma: PrismaClient): Promise<void> {
  const random = rng(20260919);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));

  /** `n` distinct members of `items`, by a deterministic shuffle. */
  const sample = <T>(items: readonly T[], n: number): T[] => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy.slice(0, Math.min(n, copy.length));
  };

  const passwordHash = await hash(SEED_PASSWORD, ARGON2_OPTIONS);

  // -- departments ---------------------------------------------------------
  const departmentId: Record<string, string> = {};
  for (const dept of DEPARTMENTS) {
    const row = await prisma.department.upsert({
      where: { code: dept.code },
      update: { name: dept.name, description: dept.description },
      create: { ...dept },
    });
    departmentId[dept.code] = row.id;
  }
  console.error(`  departments: ${DEPARTMENTS.length}`);

  // -- people --------------------------------------------------------------
  const people = buildPeople();
  const emails = people.map((p) => p.email);

  const already = await prisma.user.findMany({
    where: { email: { in: emails } },
    select: { email: true },
  });
  const have = new Set(already.map((u) => u.email));

  await createMissing(
    'users',
    people.filter((p) => !have.has(p.email)).map((p) => ({ ...p, passwordHash })),
    (rows) => prisma.user.createMany({ data: rows, skipDuplicates: true }),
  );

  // `orderBy` is load-bearing, not tidiness. Every `sample()` below draws from
  // this array, so its order IS the random stream: a SELECT with no ORDER BY
  // may come back in any order Postgres likes, and a second run that reads the
  // same rows in a different order picks different people for everything and
  // writes a whole second university beside the first.
  const users = await prisma.user.findMany({
    where: { email: { in: emails } },
    select: { id: true, email: true },
    orderBy: { email: 'asc' },
  });
  const userId: Record<string, string> = {};
  for (const u of users) userId[u.email] = u.id;

  const students = people.filter((p) => p.platformRole === 'STUDENT').map((p) => userId[p.email]!);
  const adminId = userId[`dean@${EMAIL_DOMAIN}`]!;

  // Every account carries a pass; the scanner has nothing to read without one.
  const withPass = new Set(
    (
      await prisma.qrPass.findMany({
        where: { userId: { in: Object.values(userId) } },
        select: { userId: true },
      })
    ).map((p) => p.userId),
  );
  await createMissing(
    'qr passes',
    Object.values(userId)
      .filter((id) => !withPass.has(id))
      .map((id) => ({ userId: id })),
    (rows) => prisma.qrPass.createMany({ data: rows, skipDuplicates: true }),
  );

  // -- clubs ---------------------------------------------------------------
  const clubId: Record<string, string> = {};
  for (const club of CLUBS) {
    const row = await prisma.club.upsert({
      where: { slug: club.slug },
      update: {
        name: club.name,
        description: club.about,
        category: club.category,
        academicYear: ACADEMIC_YEAR,
        membershipPolicy: club.policy,
        status: club.status ?? 'ACTIVE',
      },
      create: {
        departmentId: departmentId[club.dept]!,
        name: club.name,
        slug: club.slug,
        description: club.about,
        category: club.category,
        academicYear: ACADEMIC_YEAR,
        logoUrl: `https://placehold.co/512x512/0E5F55/FFFFFF/png?text=${initials(club.name)}`,
        membershipPolicy: club.policy,
        status: club.status ?? 'ACTIVE',
      },
    });
    clubId[club.slug] = row.id;
  }
  console.error(`  clubs: ${CLUBS.length}`);

  // -- committees ----------------------------------------------------------
  // One Lead per club is a partial unique index, so the read below is what
  // keeps a second run from colliding with it.
  const ROLES = ['LEAD', 'VICE_LEAD', 'OPERATIONS', 'CTO', 'MARKETING'] as const;

  const standing = await prisma.clubTeamAppointment.findMany({
    where: { clubId: { in: Object.values(clubId) }, status: { in: ['ACTIVE', 'INVITED'] } },
    select: { clubId: true, userId: true, role: true, status: true },
  });

  const heldAppointments = new Set(
    standing.filter((a) => a.status === 'ACTIVE').map((a) => `${a.clubId}:${a.role}`),
  );

  // An outstanding invitation has no unique index behind it and is not an
  // ACTIVE role, so without its own guard every run filed another one against
  // the same club.
  const alreadyOnTeam = new Set(standing.map((a) => `${a.clubId}:${a.userId}`));

  const appointments: Prisma.ClubTeamAppointmentCreateManyInput[] = [];
  const officersOf: Record<string, string[]> = {};

  for (const club of CLUBS) {
    const id = clubId[club.slug]!;
    // An archived club keeps its history but gains no new committee.
    const size = club.status === 'ARCHIVED' ? 2 : int(3, 5);
    const chosen = sample(students, size);
    officersOf[club.slug] = chosen;

    chosen.forEach((student, i) => {
      const role = ROLES[i]!;
      // Drawn before the guard, never after: see the note above `slugify`.
      const acceptedAt = at(-int(60, 400) * DAY);
      if (heldAppointments.has(`${id}:${role}`)) return;
      appointments.push({
        clubId: id,
        userId: student,
        role,
        status: 'ACTIVE',
        invitedById: adminId,
        acceptedAt,
      });
    });

    // One outstanding invitation per active club, so the team screen has a
    // pending row and the roster has someone to show as provisional.
    if (!club.status && random() < 0.4) {
      const invitee = sample(
        students.filter((s) => !chosen.includes(s)),
        1,
      )[0];
      const expiresAt = at(int(2, 12) * DAY);
      if (invitee && !alreadyOnTeam.has(`${id}:${invitee}`)) {
        appointments.push({
          clubId: id,
          userId: invitee,
          role: 'MARKETING',
          status: 'INVITED',
          invitedById: chosen[0]!,
          invitationExpiresAt: expiresAt,
        });
      }
    }
  }

  await createMissing('appointments', appointments, (rows) =>
    prisma.clubTeamAppointment.createMany({ data: rows, skipDuplicates: true }),
  );

  // -- memberships ---------------------------------------------------------
  const openMemberships = new Set(
    (
      await prisma.clubMembership.findMany({
        where: { clubId: { in: Object.values(clubId) }, status: { in: ['PENDING', 'ACTIVE'] } },
        select: { clubId: true, userId: true },
      })
    ).map((m) => `${m.clubId}:${m.userId}`),
  );

  const memberships: Prisma.ClubMembershipCreateManyInput[] = [];
  const membersOf: Record<string, string[]> = {};

  for (const club of CLUBS) {
    const id = clubId[club.slug]!;
    const officers = officersOf[club.slug] ?? [];
    // A closed or invite-only club is smaller by construction, and an
    // archived one stopped taking anybody a year ago.
    const target =
      club.status === 'ARCHIVED'
        ? int(4, 9)
        : club.policy === 'INVITE_ONLY' || club.policy === 'CLOSED'
          ? int(8, 18)
          : int(16, 44);

    const roster = sample(students, target);
    // Officers hold an ordinary membership too, as a separate record.
    const active = [...new Set([...officers, ...roster])];
    membersOf[club.slug] = active;

    for (const student of active) {
      // Both draws before the guard: see the note above `slugify`.
      const decidedAt = at(-int(10, 420) * DAY);
      const waited = int(1, 6);
      if (openMemberships.has(`${id}:${student}`)) continue;
      memberships.push({
        clubId: id,
        userId: student,
        status: 'ACTIVE',
        requestedAt: new Date(decidedAt.getTime() - waited * DAY),
        decidedAt,
        decidedById: officers[0] ?? adminId,
      });
    }

    // Requests waiting on the committee, but only where a committee could act
    // on them: nobody can queue for a closed or archived club.
    if (club.policy === 'APPROVAL_REQUIRED' && !club.status) {
      for (const student of sample(
        students.filter((s) => !active.includes(s)),
        int(2, 6),
      )) {
        const requestedAt = at(-int(1, 12) * DAY);
        if (openMemberships.has(`${id}:${student}`)) continue;
        memberships.push({
          clubId: id,
          userId: student,
          status: 'PENDING',
          requestedAt,
        });
      }
    }
  }

  await createMissing('memberships', memberships, (rows) =>
    prisma.clubMembership.createMany({ data: rows, skipDuplicates: true }),
  );

  // -- events --------------------------------------------------------------
  interface PlannedEvent {
    key: string;
    data: Prisma.EventCreateManyInput;
    /** Filled once the row has an id, for the registrations below. */
    club: ClubPlan;
    certificate: boolean;
  }

  const planned: PlannedEvent[] = [];

  for (const club of CLUBS) {
    const id = clubId[club.slug]!;
    const officers = officersOf[club.slug] ?? [];
    const createdById = officers[0] ?? adminId;

    club.events.forEach(([title, eventType], i) => {
      const arc = ARC[i % ARC.length]!;
      // An archived club's whole history is behind it.
      if (club.status === 'ARCHIVED' && arc.days > 0) return;

      const jitter = int(-2, 2) * DAY + int(0, 8) * HOUR;
      const startsAt = at(arc.days * DAY + jitter);
      const endsAt = new Date(startsAt.getTime() + arc.hours * HOUR);
      const capacity = int(18, 120);

      planned.push({
        key: `${club.slug}/${slugify(title)}`,
        club,
        certificate: arc.certificate,
        data: {
          clubId: id,
          createdById,
          title,
          slug: slugify(title),
          summary: `${eventType} run by ${club.name}.`,
          description: `${title}.\n\n${club.about.split('\n')[0]}\n\nDoors open fifteen minutes before the start. Bring your student pass for check-in.`,
          eventType,
          audience: pick(['All students', 'Members only', 'Open to the public', 'First years']),
          venue: club.venue,
          timezone: 'Asia/Dubai',
          startsAt,
          endsAt,
          registrationOpensAt: new Date(startsAt.getTime() - int(14, 28) * DAY),
          // `<= endsAt` is a CHECK constraint, not a convention.
          registrationClosesAt: new Date(startsAt.getTime() - 2 * HOUR),
          capacity,
          confirmedCount: 0,
          waitlistEnabled: random() < 0.75,
          requiresClubMembership: random() < 0.25,
          certificateEnabled: arc.certificate,
          certificateTitle: arc.certificate ? `Certificate of Attendance: ${title}` : null,
          certificateSignatory: arc.certificate ? `Head of ${DEPARTMENTS.find((d) => d.code === club.dept)!.name}` : null,
          status: arc.status,
        },
      });
    });

    // One club in four has something on right now, which is the only state
    // the scanner can be demonstrated against.
    if (!club.status && random() < 0.28) {
      const startsAt = at(-int(30, 90) * 60_000);
      const endsAt = at(int(90, 210) * 60_000);
      planned.push({
        key: `${club.slug}/open-session-tonight`,
        club,
        certificate: false,
        data: {
          clubId: id,
          createdById,
          title: 'Open Session',
          slug: 'open-session-tonight',
          summary: `Drop-in evening with ${club.name}.`,
          description: 'Running now. Check in at the door with your student pass.',
          eventType: 'Social',
          audience: 'All students',
          venue: club.venue,
          timezone: 'Asia/Dubai',
          startsAt,
          endsAt,
          registrationOpensAt: at(-21 * DAY),
          registrationClosesAt: at(-2 * HOUR),
          capacity: int(30, 80),
          confirmedCount: 0,
          waitlistEnabled: true,
          requiresClubMembership: false,
          certificateEnabled: false,
          status: 'PUBLISHED',
        },
      });
    }
  }

  // One cancelled event, so the badge and the cancelled path have a subject.
  const cancelledHost = CLUBS[0]!;
  planned.push({
    key: `${cancelledHost.slug}/hardware-swap-meet`,
    club: cancelledHost,
    certificate: false,
    data: {
      clubId: clubId[cancelledHost.slug]!,
      createdById: officersOf[cancelledHost.slug]?.[0] ?? adminId,
      title: 'Hardware Swap Meet',
      slug: 'hardware-swap-meet',
      summary: 'Bring parts you are not using, leave with parts you are.',
      description: 'Cancelled: the venue was withdrawn at short notice.',
      eventType: 'Social',
      audience: 'All students',
      venue: cancelledHost.venue,
      timezone: 'Asia/Dubai',
      startsAt: at(13 * DAY),
      endsAt: at(13 * DAY + 3 * HOUR),
      registrationOpensAt: at(-6 * DAY),
      registrationClosesAt: at(13 * DAY - 2 * HOUR),
      capacity: 60,
      confirmedCount: 0,
      waitlistEnabled: false,
      requiresClubMembership: false,
      certificateEnabled: false,
      status: 'CANCELLED',
      cancelledReason: 'The venue was withdrawn at short notice.',
    },
  });

  const existingEvents = await prisma.event.findMany({
    where: { clubId: { in: Object.values(clubId) } },
    select: { id: true, clubId: true, slug: true },
  });
  const eventKey = new Map(
    existingEvents.map((e) => [`${e.clubId}/${e.slug}`, e.id] as const),
  );

  await createMissing(
    'events',
    planned
      .filter((p) => !eventKey.has(`${p.data.clubId}/${p.data.slug}`))
      .map((p) => p.data),
    (rows) => prisma.event.createMany({ data: rows, skipDuplicates: true }),
  );

  const allEvents = await prisma.event.findMany({
    where: { clubId: { in: Object.values(clubId) } },
    select: { id: true, clubId: true, slug: true, capacity: true, status: true, endsAt: true, title: true, waitlistEnabled: true },
    // Same reason as the user read above: this one feeds the registration
    // sampling.
    orderBy: { id: 'asc' },
  });
  const eventById = new Map(allEvents.map((e) => [e.id, e] as const));
  const idOf = new Map(allEvents.map((e) => [`${e.clubId}/${e.slug}`, e.id] as const));

  // -- registrations -------------------------------------------------------
  // Every pair, CANCELLED included. The database only forbids a second OPEN
  // registration, but "have I seeded this already?" is a different question:
  // filtering cancelled rows out here meant the seed never saw the ones it
  // wrote for the cancelled event and filed twelve more on every run.
  const seededRegistrations = new Set(
    (
      await prisma.eventRegistration.findMany({
        where: { eventId: { in: allEvents.map((e) => e.id) } },
        select: { eventId: true, userId: true },
      })
    ).map((r) => `${r.eventId}:${r.userId}`),
  );

  const registrations: Prisma.EventRegistrationCreateManyInput[] = [];

  for (const plan of planned) {
    const id = idOf.get(`${plan.data.clubId}/${plan.data.slug}`);
    if (!id) continue;
    const event = eventById.get(id)!;
    if (event.status === 'DRAFT') continue;

    const pool = membersOf[plan.club.slug] ?? [];
    if (pool.length === 0) continue;

    const past = event.endsAt.getTime() < Date.now();
    const wanted = Math.min(event.capacity, Math.round(pool.length * (0.35 + random() * 0.55)));
    const attendees = sample(pool, wanted);

    attendees.forEach((student, i) => {
      // Both draws first, unconditionally: see the note above `slugify`. One
      // of these used to sit inside the `past` branch and the other after the
      // skip below, which made the stream depend on what was already stored.
      const turnedUp = random() < 0.78;
      const bookedDaysAhead = int(2, 25);

      if (seededRegistrations.has(`${id}:${student}`)) return;

      // Past the capacity line, and only where the event takes a waitlist.
      const overflow = i >= event.capacity;
      if (overflow && !event.waitlistEnabled) return;

      let status: Prisma.EventRegistrationCreateManyInput['status'];
      let waitlistPosition: number | null = null;

      if (overflow) {
        status = 'WAITLISTED';
        waitlistPosition = i - event.capacity + 1;
      } else if (event.status === 'CANCELLED') {
        status = 'CANCELLED';
      } else if (past) {
        // What the lifecycle leaves behind: whoever scanned is CHECKED_IN, and
        // every seat that never scanned was swept to NO_SHOW. CONFIRMED is not
        // a state a finished event can be in.
        status = turnedUp ? 'CHECKED_IN' : 'NO_SHOW';
      } else {
        status = 'CONFIRMED';
      }

      registrations.push({
        eventId: id,
        userId: student,
        status,
        waitlistPosition,
        registeredAt: new Date(
          Math.min(Date.now(), event.endsAt.getTime()) - bookedDaysAhead * DAY,
        ),
        ...(status === 'CANCELLED' ? { cancelledAt: at(-2 * DAY), cancelledById: student } : {}),
        source: 'SELF',
      });
    });
  }

  await createMissing('registrations', registrations, (rows) =>
    prisma.eventRegistration.createMany({ data: rows, skipDuplicates: true }),
  );

  // The counter is the app's own invariant, so it is set from the rows that
  // actually landed rather than from the ones that were planned. One
  // statement, not one per event: the database is remote and ninety round
  // trips here would dominate the whole seed.
  //
  // LEAST(..., capacity) is belt and braces against `event_capacity_bounds`,
  // which would otherwise abort the statement rather than the row.
  const counters = await prisma.$executeRaw`
    UPDATE "event" e
       SET "confirmed_count" = LEAST(c.n, e."capacity")
      FROM (
             SELECT "event_id", COUNT(*)::int AS n
               FROM "event_registration"
              WHERE "status" IN ('CONFIRMED', 'CHECKED_IN', 'ATTENDED', 'NO_SHOW')
              GROUP BY "event_id"
           ) c
     WHERE c."event_id" = e."id"
       AND e."id" = ANY(${allEvents.map((e) => e.id)}::uuid[])
  `;
  console.error(`  confirmed counts: ${counters}`);

  // -- attendance ----------------------------------------------------------
  const checkedIn = await prisma.eventRegistration.findMany({
    where: { eventId: { in: allEvents.map((e) => e.id) }, status: 'CHECKED_IN' },
    select: { id: true, eventId: true, userId: true },
  });
  const recorded = new Set(
    (
      await prisma.attendanceRecord.findMany({
        where: { registrationId: { in: checkedIn.map((r) => r.id) } },
        select: { registrationId: true },
      })
    ).map((a) => a.registrationId),
  );

  await createMissing(
    'attendance records',
    // Mapped before it is filtered, so the draw happens for every candidate
    // rather than only the rows this run writes. See the note above `slugify`.
    checkedIn
      .map((r) => {
        const event = eventById.get(r.eventId)!;
        return {
          keep: !recorded.has(r.id),
          registrationId: r.id,
          eventId: r.eventId,
          userId: r.userId,
          // While the event was running, which is what a scan means.
          checkedInAt: new Date(event.endsAt.getTime() - int(30, 180) * 60_000),
          checkedInById: adminId,
          method: 'QR_SCAN' as const,
        };
      })
      .filter((r) => r.keep)
      .map(({ keep: _keep, ...row }) => row),
    (rows) => prisma.attendanceRecord.createMany({ data: rows, skipDuplicates: true }),
  );

  // -- certificates --------------------------------------------------------
  // Only for CERTIFIED events, and only for a registration that was actually
  // in the room: spec 7.6, a NO_SHOW never receives one.
  const certifiedEventIds = allEvents.filter((e) => e.status === 'CERTIFIED').map((e) => e.id);

  if (certifiedEventIds.length > 0) {
    const eligible = await prisma.eventRegistration.findMany({
      where: { eventId: { in: certifiedEventIds }, status: { in: ['CHECKED_IN', 'ATTENDED'] } },
      select: {
        id: true,
        eventId: true,
        userId: true,
        user: { select: { fullName: true } },
        event: { select: { title: true, club: { select: { name: true, logoUrl: true } } } },
      },
    });

    const issued = new Set(
      (
        await prisma.certificate.findMany({
          where: { registrationId: { in: eligible.map((r) => r.id) }, status: 'ACTIVE' },
          select: { registrationId: true },
        })
      ).map((c) => c.registrationId),
    );

    await createMissing(
      'certificates',
      // Mapped before filtered, for the same reason attendance is. The codes
      // come from the service's own generators, not this seed's PRNG: they are
      // unique keys, and a deterministic stream would collide with itself the
      // moment two databases were seeded from it.
      eligible
        .map((r) => ({
          keep: !issued.has(r.id),
          registrationId: r.id,
          eventId: r.eventId,
          userId: r.userId,
          serialNumber: serialNumber(),
          verificationCode: verificationCode(),
          // Snapshots, by design: a later rename must not alter an issued
          // certificate.
          holderNameSnapshot: r.user.fullName,
          eventTitleSnapshot: r.event.title,
          clubNameSnapshot: r.event.club.name,
          clubLogoSnapshotUrl: r.event.club.logoUrl,
          issuedAt: at(-int(3, 40) * DAY),
        }))
        .filter((r) => r.keep)
        .map(({ keep: _keep, ...row }) => row),
      (rows) => prisma.certificate.createMany({ data: rows, skipDuplicates: true }),
    );
  }

  await adoptExistingPeople(prisma, clubId, emails, adminId);
}

/**
 * Accounts that were in the database before this seed ran get memberships in a
 * handful of clubs and one Vice Lead appointment, so whoever owns them can
 * open the student screens and the officer console without being invited by
 * hand first.
 *
 * The one place this seed touches a row it did not create. Undo is in the
 * README section this prints.
 */
async function adoptExistingPeople(
  prisma: PrismaClient,
  clubId: Record<string, string>,
  seededEmails: string[],
  adminId: string,
): Promise<void> {
  const outsiders = await prisma.user.findMany({
    where: { email: { notIn: seededEmails }, status: 'ACTIVE' },
    select: { id: true, email: true, platformRole: true },
    orderBy: { createdAt: 'asc' },
  });
  if (outsiders.length === 0) {
    console.error('  existing accounts: none to adopt');
    return;
  }

  const joinable = ['robotics-society', 'ai-data-circle', 'astronomy-society', 'entrepreneurship-hub', 'debate-union']
    .map((slug) => clubId[slug])
    .filter((id): id is string => id !== undefined);

  const open = new Set(
    (
      await prisma.clubMembership.findMany({
        where: {
          clubId: { in: joinable },
          userId: { in: outsiders.map((u) => u.id) },
          status: { in: ['PENDING', 'ACTIVE'] },
        },
        select: { clubId: true, userId: true },
      })
    ).map((m) => `${m.clubId}:${m.userId}`),
  );

  const rows: Prisma.ClubMembershipCreateManyInput[] = [];
  for (const user of outsiders) {
    for (const club of joinable) {
      if (open.has(`${club}:${user.id}`)) continue;
      rows.push({
        clubId: club,
        userId: user.id,
        status: 'ACTIVE',
        requestedAt: new Date(Date.now() - 30 * DAY),
        decidedAt: new Date(Date.now() - 29 * DAY),
        decidedById: adminId,
      });
    }
  }

  await createMissing('existing accounts joined clubs', rows, (batch) =>
    prisma.clubMembership.createMany({ data: batch, skipDuplicates: true }),
  );

  // Vice Lead, not Lead: one ACTIVE Lead per club is a partial unique index,
  // and the seeded committee already holds it. Vice Lead carries the same
  // field-level access on the profile, which is what makes the console worth
  // opening.
  const student = outsiders.find((u) => u.platformRole === 'STUDENT') ?? outsiders[0]!;
  const club = clubId['ai-data-circle'];
  if (!club) return;

  const held = await prisma.clubTeamAppointment.findFirst({
    where: { clubId: club, userId: student.id, status: 'ACTIVE' },
    select: { id: true },
  });
  if (held) {
    console.error('  existing account already an officer');
    return;
  }

  await prisma.clubTeamAppointment.create({
    data: {
      clubId: club,
      userId: student.id,
      role: 'VICE_LEAD',
      status: 'ACTIVE',
      invitedById: adminId,
      acceptedAt: new Date(Date.now() - 20 * DAY),
    },
  });
  console.error(`  ${student.email} is now Vice Lead of AI and Data Circle`);
}

/**
 * Why every random draw in this file happens before the guard that may skip
 * the row, and never after it.
 *
 * The PRNG is seeded, so the same sequence of draws builds the same
 * university. "The same sequence" is the whole contract: a draw that only runs
 * for rows this particular run decides to write makes the sequence a function
 * of what is already stored, and the next run then picks different people for
 * everything downstream and writes a second university beside the first.
 *
 * Measured, not theorised. Before this, a second run added 1,186 registrations
 * to a database that already held every one of them.
 */

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set.');
  assertSafeToSeed(url, process.env);

  const prisma = new PrismaClient({ adapter: pgAdapter(url) });
  try {
    console.error(`Seeding demo data into ${new URL(url).hostname} ...`);
    await seedDemo(prisma);
    console.error(`Demo seed complete. Every seeded account signs in with: ${SEED_PASSWORD}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main();
}
