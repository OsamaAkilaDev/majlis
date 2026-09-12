import { Injectable } from '@nestjs/common';
import type { CreateDepartmentBody, CursorPageQuery, Department, DepartmentPage, PatchDepartmentBody } from '@majlis/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- must stay a value import: Nest's constructor DI resolves this provider from the emitted `design:paramtypes` metadata, which needs a real runtime reference.
import { AuditService } from '../audit/audit.service';
import { ConflictError, NotFoundError } from '../common/problem/domain-error';
import { Prisma, type Department as DepartmentRow } from '../generated/prisma/client';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- must stay a value import: same reason as AuditService above.
import { TransactionHost } from '../prisma/transaction.host';

/** Maps a row plus its club count onto the wire shape. */
function toDepartment(row: DepartmentRow, clubCount: number): Department {
  return { id: row.id, name: row.name, code: row.code, description: row.description, clubCount };
}

/**
 * Turns a raw Prisma write error into the DomainError it means, rather than
 * letting it escape as a 500. P2002 is the unique violation on name or code;
 * P2003 is the foreign key violation `onDelete: Restrict` raises when a club
 * still points at this department.
 */
function mapWriteError(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === 'P2002') throw new ConflictError('A department with that name or code already exists.');
    if (e.code === 'P2003') throw new ConflictError('That department still has clubs.');
    if (e.code === 'P2025') throw new NotFoundError('No such department.');
  }
  throw e;
}

@Injectable()
export class DepartmentsService {
  constructor(
    private readonly host: TransactionHost,
    private readonly audit: AuditService,
  ) {}

  /** GET /departments. Same cursor pattern as UsersService.list. */
  async list(query: CursorPageQuery): Promise<DepartmentPage> {
    const rows = await this.host.tx.department.findMany({
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      orderBy: { id: 'asc' },
      include: { _count: { select: { clubs: true } } },
    });

    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;

    return {
      items: items.map((d) => toDepartment(d, d._count.clubs)),
      nextCursor: hasMore ? items[items.length - 1]!.id : null,
    };
  }

  async create(actor: { id: string }, body: CreateDepartmentBody): Promise<Department> {
    return this.host.run(async () => {
      const row = await this.host.tx.department
        .create({ data: { name: body.name, code: body.code, description: body.description ?? null } })
        .catch(mapWriteError);

      await this.audit.record({
        action: 'department.created',
        entityType: 'Department',
        entityId: row.id,
        outcome: 'SUCCESS',
        actorUserId: actor.id,
        after: { name: row.name, code: row.code },
      });

      return toDepartment(row, 0);
    });
  }

  async update(actor: { id: string }, id: string, body: PatchDepartmentBody): Promise<Department> {
    return this.host.run(async () => {
      const before = await this.host.tx.department.findUnique({ where: { id } });
      if (!before) throw new NotFoundError('No such department.');

      const data: { name?: string; code?: string; description?: string | null } = {};
      if (body.name !== undefined) data.name = body.name;
      if (body.code !== undefined) data.code = body.code;
      if (body.description !== undefined) data.description = body.description;

      const after = await this.host.tx.department.update({ where: { id }, data }).catch(mapWriteError);
      const clubCount = await this.host.tx.club.count({ where: { departmentId: id } });

      await this.audit.record({
        action: 'department.updated',
        entityType: 'Department',
        entityId: id,
        outcome: 'SUCCESS',
        actorUserId: actor.id,
        before: { name: before.name, code: before.code, description: before.description },
        after: { name: after.name, code: after.code, description: after.description },
      });

      return toDepartment(after, clubCount);
    });
  }

  async remove(actor: { id: string }, id: string): Promise<void> {
    return this.host.run(async () => {
      const before = await this.host.tx.department.findUnique({ where: { id } });
      if (!before) throw new NotFoundError('No such department.');

      await this.host.tx.department.delete({ where: { id } }).catch(mapWriteError);

      await this.audit.record({
        action: 'department.deleted',
        entityType: 'Department',
        entityId: id,
        outcome: 'SUCCESS',
        actorUserId: actor.id,
        before: { name: before.name, code: before.code },
      });
    });
  }
}
