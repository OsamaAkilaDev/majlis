import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import {
  patchMeBodySchema,
  patchUserBodySchema,
  patchUserStatusBodySchema,
  userListQuerySchema,
  userSearchQuerySchema,
  type Me,
  type UserListPage,
  type UserProfile,
  type UserSearchResult,
} from '@majlis/contracts';
import { createZodDto } from 'nestjs-zod';
import { Actor } from '../auth/actor.decorator';
import { RequirePermission } from '../auth/require-permission.decorator';
import { ProblemDetailsDto } from '../common/problem/problem-details.dto';
import type { User } from '../generated/prisma/client';
import { UsersService } from './users.service';

class PatchMeDto extends createZodDto(patchMeBodySchema) {}
class PatchUserDto extends createZodDto(patchUserBodySchema) {}
class PatchUserStatusDto extends createZodDto(patchUserStatusBodySchema) {}
class UsersQueryDto extends createZodDto(userListQuerySchema) {}
class UserSearchQueryDto extends createZodDto(userSearchQuerySchema) {}

/**
 * No single `@Controller(prefix)` fits all four routes: `/me` sits outside
 * `/users` entirely (spec: a profile-edit response must never carry the
 * authorization facts `/auth/me` does, so it isn't nested under the admin
 * listing either). Left blank; each handler spells out its own full path.
 *
 * Both global guards apply here (see auth.module.ts), so no local
 * @UseGuards is needed: SessionGuard authenticates and PermissionsGuard
 * authorizes, and any route without @Public() is protected by default.
 */
@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @ApiResponse({ status: 401, description: 'Not signed in.', type: ProblemDetailsDto })
  me(@Actor() actor: User): Me {
    return this.users.me(actor);
  }

  @Patch('me')
  @ApiResponse({ status: 401, description: 'Not signed in.', type: ProblemDetailsDto })
  updateMe(@Actor() actor: User, @Body() body: PatchMeDto): Promise<Me> {
    return this.users.updateMe(actor, body);
  }

  @Get('users')
  @RequirePermission('user:list')
  list(@Query() query: UsersQueryDto): Promise<UserListPage> {
    return this.users.list(query);
  }

  /**
   * Nested under the club on purpose. `user:search` is a club-scoped rule,
   * and a club rule cannot authorize a route with no club in it: on a bare
   * `/users/search` the guard would have no clubId to resolve roles
   * against, and only the platform half of the rule could ever match.
   */
  @Get('clubs/:clubId/user-search')
  @RequirePermission('user:search', { scope: 'club', from: 'params.clubId' })
  search(@Query() query: UserSearchQueryDto): Promise<UserSearchResult> {
    return this.users.search(query);
  }

  /**
   * Deliberately declared before `users/:id/status`. Nest matches in
   * declaration order, and the two never collide because the paths differ by
   * a segment, but keeping the broader edit above the narrower status route
   * mirrors how the two read in the permission matrix.
   */
  @Patch('users/:id')
  @RequirePermission('user:edit')
  @ApiResponse({ status: 404, description: 'No such user.', type: ProblemDetailsDto })
  @ApiResponse({ status: 409, description: 'That email is already taken.', type: ProblemDetailsDto })
  @ApiResponse({ status: 422, description: 'Nothing to change, your own role, or the last admin.', type: ProblemDetailsDto })
  update(
    @Actor() actor: User,
    @Param('id') id: string,
    @Body() body: PatchUserDto,
  ): Promise<UserProfile> {
    return this.users.update(actor, id, body);
  }

  @Patch('users/:id/status')
  @RequirePermission('user:suspend')
  @ApiResponse({ status: 404, description: 'No such user.', type: ProblemDetailsDto })
  @ApiResponse({ status: 409, description: 'That account is already in that state.', type: ProblemDetailsDto })
  @ApiResponse({ status: 422, description: 'You cannot change your own account status.', type: ProblemDetailsDto })
  updateStatus(
    @Actor() actor: User,
    @Param('id') id: string,
    @Body() body: PatchUserStatusDto,
  ): Promise<UserProfile> {
    return this.users.updateStatus(actor, id, body);
  }
}
