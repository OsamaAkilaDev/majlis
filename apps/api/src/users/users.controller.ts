import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import {
  cursorPageQuerySchema,
  patchMeBodySchema,
  patchUserStatusBodySchema,
  type Me,
  type UserListPage,
  type UserProfile,
} from '@majlis/contracts';
import { createZodDto } from 'nestjs-zod';
import { Actor } from '../auth/actor.decorator';
import { RequirePermission } from '../auth/require-permission.decorator';
import type { User } from '../generated/prisma/client';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- must stay a value import: Nest's constructor DI resolves this provider from the emitted `design:paramtypes` metadata, which needs a real runtime reference.
import { UsersService } from './users.service';

class PatchMeDto extends createZodDto(patchMeBodySchema) {}
class PatchUserStatusDto extends createZodDto(patchUserStatusBodySchema) {}
class UsersQueryDto extends createZodDto(cursorPageQuerySchema) {}

/**
 * No single `@Controller(prefix)` fits all four routes — `/me` sits outside
 * `/users` entirely (spec: a profile-edit response must never carry the
 * authorization facts `/auth/me` does, so it isn't nested under the admin
 * listing either). Left blank; each handler spells out its own full path.
 */
@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  me(@Actor() actor: User): Me {
    return this.users.me(actor);
  }

  @Patch('me')
  updateMe(@Actor() actor: User, @Body() body: PatchMeDto): Promise<Me> {
    return this.users.updateMe(actor, body);
  }

  @Get('users')
  @RequirePermission('user:list')
  list(@Query() query: UsersQueryDto): Promise<UserListPage> {
    return this.users.list(query);
  }

  @Patch('users/:id/status')
  @RequirePermission('user:suspend')
  updateStatus(
    @Actor() actor: User,
    @Param('id') id: string,
    @Body() body: PatchUserStatusDto,
  ): Promise<UserProfile> {
    return this.users.updateStatus(actor, id, body);
  }
}
