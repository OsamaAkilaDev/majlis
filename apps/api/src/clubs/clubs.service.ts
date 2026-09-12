import { Injectable } from '@nestjs/common';
import { IMAGE_KINDS, type ClubDetail, type ClubListQuery, type ClubPage, type ClubSummary, type CreateClubBody, type ImageKind, type NewClubUpload } from '@majlis/contracts';
import { v7 as uuidv7 } from 'uuid';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- value import: Nest DI resolves this from design:paramtypes.
import { AuditService } from '../audit/audit.service';
import { ConflictError, NotFoundError, UnprocessableError } from '../common/problem/domain-error';
import { Prisma, type Club as ClubRow } from '../generated/prisma/client';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- must stay a value import: Nest's constructor DI resolves this provider from the emitted `design:paramtypes` metadata, which needs a real runtime reference.
import { TransactionHost } from '../prisma/transaction.host';
import { objectPath } from '../storage/image-kinds';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- must stay a value import: same reason as AuditService above.
import { StorageService } from '../storage/storage.service';
import { deriveSlug, uniqueSlug } from './slug';

const ACTIVE_ONLY = { status: 'ACTIVE' } as const;

/** Maps a club row plus its computed fields onto the wire summary shape. */
function toClubSummary(row: ClubRow, departmentName: string, memberCount: number): ClubSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.category,
    logoUrl: row.logoUrl,
    status: row.status,
    membershipPolicy: row.membershipPolicy,
    departmentName,
    memberCount,
  };
}

/** Extends the summary with the fields only the detail read carries. */
function toClubDetail(
  row: ClubRow,
  departmentName: string,
  memberCount: number,
  viewerMembershipStatus: ClubDetail['viewerMembershipStatus'],
  viewerClubRoles: ClubDetail['viewerClubRoles'],
): ClubDetail {
  return {
    ...toClubSummary(row, departmentName, memberCount),
    description: row.description,
    academicYear: row.academicYear,
    bannerUrl: row.bannerUrl,
    departmentId: row.departmentId,
    viewerMembershipStatus,
    viewerClubRoles,
  };
}

/**
 * P2002 here is the unique violation on either name or slug. `uniqueSlug`'s
 * pre-check is not a guarantee under READ COMMITTED: two concurrent creates
 * with different names that derive the same base slug can both see it free,
 * so the loser must still be told which constraint actually fired rather
 * than being blamed for a name collision that never happened.
 */
function mapWriteError(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    const target = e.meta?.target;
    const columns = Array.isArray(target) ? target : typeof target === 'string' ? [target] : [];
    if (columns.includes('slug')) throw new ConflictError('A club with that slug already exists.');
    throw new ConflictError('A club with that name already exists.');
  }
  throw e;
}

@Injectable()
export class ClubsService {
  constructor(
    private readonly host: TransactionHost,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  /**
   * POST /uploads/club-logo. Mints the id the club will be created with, so
   * the object path (derived from that id) exists before the upload does,
   * plus a one-use signed URL to upload to that path.
   */
  async mintLogoUpload(): Promise<NewClubUpload> {
    const clubId = uuidv7();
    const path = objectPath('club-logo', clubId);
    const { signedUrl, token } = await this.storage.createSignedUploadUrl(path);
    return { clubId, path, signedUrl, token, publicUrl: this.storage.publicUrlFor(path, Date.now()) };
  }

  /**
   * The API never sees the image bytes, so no handler stores a URL it has
   * not confirmed. Returns the versioned public URL to store.
   */
  async verifyUpload(kind: ImageKind, resourceId: string): Promise<string> {
    const path = objectPath(kind, resourceId);
    const stat = await this.storage.statObject(path);

    if (!stat) throw new UnprocessableError('That image was not uploaded.');
    if (stat.contentType !== 'image/webp') throw new UnprocessableError('That image is not a WebP.');
    if (stat.size > IMAGE_KINDS[kind].maxBytes) throw new UnprocessableError('That image is too large.');

    return this.storage.publicUrlFor(path, Date.now());
  }

  async create(actor: { id: string }, body: CreateClubBody): Promise<ClubDetail> {
    return this.host.run(async () => {
      const logoUrl = await this.verifyUpload('club-logo', body.clubId);
      const slug = await uniqueSlug(deriveSlug(body.name), (s) =>
        this.host.tx.club.count({ where: { slug: s } }).then((n) => n > 0),
      );

      const row = await this.host.tx.club
        .create({
          data: {
            id: body.clubId,
            departmentId: body.departmentId,
            name: body.name,
            slug,
            description: body.description,
            category: body.category,
            academicYear: body.academicYear,
            logoUrl,
            membershipPolicy: body.membershipPolicy,
          },
          include: { department: { select: { name: true } } },
        })
        .catch(mapWriteError);

      await this.audit.record({
        action: 'club.created',
        entityType: 'Club',
        entityId: row.id,
        outcome: 'SUCCESS',
        actorUserId: actor.id,
        after: { name: row.name, slug: row.slug, departmentId: row.departmentId },
      });

      // A brand new club has no memberships yet.
      return toClubDetail(row, row.department.name, 0, null, []);
    });
  }

  /** GET /clubs. Same cursor pattern as UsersService.list and DepartmentsService.list. */
  async list(query: ClubListQuery): Promise<ClubPage> {
    const where: Prisma.ClubWhereInput = {
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' as const } } : {}),
    };

    const rows = await this.host.tx.club.findMany({
      where,
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      orderBy: { id: 'asc' },
      include: {
        department: { select: { name: true } },
        _count: { select: { memberships: { where: ACTIVE_ONLY } } },
      },
    });

    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;

    return {
      items: items.map((c) => toClubSummary(c, c.department.name, c._count.memberships)),
      nextCursor: hasMore ? items[items.length - 1]!.id : null,
    };
  }

  /**
   * GET /clubs/:clubId. The membership and appointment reads are scoped to
   * `actor.id`: a query missing that filter would answer with whichever row
   * happens to come first, telling a student they belong to a club they
   * never joined.
   */
  async detail(actor: { id: string }, clubId: string): Promise<ClubDetail> {
    const club = await this.host.tx.club.findUnique({
      where: { id: clubId },
      include: {
        department: { select: { name: true } },
        _count: { select: { memberships: { where: ACTIVE_ONLY } } },
      },
    });
    if (!club) throw new NotFoundError('No such club.');

    const membership = await this.host.tx.clubMembership.findFirst({
      where: { clubId, userId: actor.id },
      orderBy: { requestedAt: 'desc' },
    });
    const appointments = await this.host.tx.clubTeamAppointment.findMany({
      where: { clubId, userId: actor.id, status: 'ACTIVE' },
    });

    return toClubDetail(
      club,
      club.department.name,
      club._count.memberships,
      membership?.status ?? null,
      appointments.map((a) => a.role),
    );
  }
}
