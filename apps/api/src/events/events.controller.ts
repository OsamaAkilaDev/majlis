import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import {
  assignResponsibilityBodySchema,
  cancelEventBodySchema,
  createEventBodySchema,
  cursorPageQuerySchema,
  eventListQuerySchema,
  patchEventBodySchema,
  publishEventBodySchema,
  removeAssignmentBodySchema,
  type Assignment,
  type AssignmentList,
  type EventDetail,
  type EventPage,
  type NewEventUpload,
  type SignedUpload,
} from '@majlis/contracts';
import { createZodDto } from 'nestjs-zod';
import { Actor } from '../auth/actor.decorator';
import { RequirePermission } from '../auth/require-permission.decorator';
import { ProblemDetailsDto } from '../common/problem/problem-details.dto';
import type { User } from '../generated/prisma/client';
import { AssignmentsService } from './assignments.service';
import { EventsService } from './events.service';

class CreateEventDto extends createZodDto(createEventBodySchema) {}
class PatchEventDto extends createZodDto(patchEventBodySchema) {}
class CancelEventDto extends createZodDto(cancelEventBodySchema) {}
class AssignResponsibilityDto extends createZodDto(assignResponsibilityBodySchema) {}
class EventListQueryDto extends createZodDto(eventListQuerySchema) {}
class PublishEventDto extends createZodDto(publishEventBodySchema) {}
class RemoveAssignmentDto extends createZodDto(removeAssignmentBodySchema) {}
class CursorPageQueryDto extends createZodDto(cursorPageQuerySchema) {}

const FORBIDDEN = { status: 403, description: 'You do not have permission to do that.', type: ProblemDetailsDto };
const NO_EVENT = { status: 404, description: 'No such event.', type: ProblemDetailsDto };

/**
 * Every event-scoped route names its parameter `:eventId` and every
 * club-scoped one `:clubId`, because PermissionsGuard reads the scope id from
 * the literal dotted path in the decorator: a mismatch resolves no scope and
 * denies a real Lead with no type error and no failing test.
 */
@Controller()
export class EventsController {
  constructor(
    private readonly events: EventsService,
    private readonly assignments: AssignmentsService,
  ) {}

  /**
   * Club-scoped rather than a bare `/uploads/event-poster`: `event:create` is
   * held by club Leads, and an unscoped route resolves no club role, so a
   * Lead would be denied their own club's poster upload.
   */
  @Post('clubs/:clubId/uploads/event-poster')
  @RequirePermission('event:create', { scope: 'club', from: 'params.clubId' })
  @ApiResponse(FORBIDDEN)
  mintPosterUpload(): Promise<NewEventUpload> {
    return this.events.mintPosterUpload();
  }

  @Post('clubs/:clubId/events')
  @RequirePermission('event:create', { scope: 'club', from: 'params.clubId' })
  @ApiResponse(FORBIDDEN)
  @ApiResponse({ status: 404, description: 'No such club.', type: ProblemDetailsDto })
  @ApiResponse({ status: 409, description: 'That club already has an event with that slug.', type: ProblemDetailsDto })
  @ApiResponse({ status: 422, description: 'That club is not accepting new activity, or the windows are inconsistent.', type: ProblemDetailsDto })
  create(
    @Actor() actor: User,
    @Param('clubId') clubId: string,
    @Body() body: CreateEventDto,
  ): Promise<EventDetail> {
    return this.events.create(actor, clubId, body);
  }

  @Get('events')
  @ApiResponse({ status: 400, description: 'limit is over MAX_PAGE_LIMIT.', type: ProblemDetailsDto })
  list(@Actor() actor: User, @Query() query: EventListQueryDto): Promise<EventPage> {
    return this.events.list(actor, query);
  }

  @Get('events/:eventId')
  @ApiResponse(NO_EVENT)
  detail(@Actor() actor: User, @Param('eventId') eventId: string): Promise<EventDetail> {
    return this.events.detail(actor, eventId);
  }

  @Patch('events/:eventId')
  @RequirePermission('event:edit', { scope: 'event', from: 'params.eventId' })
  @ApiResponse(FORBIDDEN)
  @ApiResponse(NO_EVENT)
  @ApiResponse({ status: 422, description: 'The event is final, the windows are inconsistent, or capacity is below the confirmed count.', type: ProblemDetailsDto })
  update(
    @Actor() actor: User,
    @Param('eventId') eventId: string,
    @Body() body: PatchEventDto,
  ): Promise<EventDetail> {
    return this.events.update(actor, eventId, body);
  }

  @Post('events/:eventId/poster-upload-url')
  @RequirePermission('event:edit', { scope: 'event', from: 'params.eventId' })
  @ApiResponse(FORBIDDEN)
  posterUploadUrl(@Actor() actor: User, @Param('eventId') eventId: string): Promise<SignedUpload> {
    return this.events.mintEditUpload(actor, eventId);
  }

  @Post('events/:eventId/publish')
  @RequirePermission('event:publish', { scope: 'event', from: 'params.eventId' })
  @ApiResponse(FORBIDDEN)
  @ApiResponse(NO_EVENT)
  @ApiResponse({ status: 422, description: 'That club is not active, or the event cannot be published from its current state.', type: ProblemDetailsDto })
  publish(
    @Actor() actor: User,
    @Param('eventId') eventId: string,
    @Body() body: PublishEventDto,
  ): Promise<EventDetail> {
    return this.events.publish(actor, eventId, body);
  }

  @Post('events/:eventId/cancel')
  @RequirePermission('event:cancel', { scope: 'event', from: 'params.eventId' })
  @ApiResponse(FORBIDDEN)
  @ApiResponse(NO_EVENT)
  @ApiResponse({ status: 422, description: 'That event cannot be cancelled from its current state.', type: ProblemDetailsDto })
  cancel(
    @Actor() actor: User,
    @Param('eventId') eventId: string,
    @Body() body: CancelEventDto,
  ): Promise<EventDetail> {
    return this.events.cancel(actor, eventId, body);
  }

  @Get('events/:eventId/assignments')
  @RequirePermission('event:assign', { scope: 'event', from: 'params.eventId' })
  @ApiResponse(FORBIDDEN)
  @ApiResponse(NO_EVENT)
  listAssignments(
    @Param('eventId') eventId: string,
    @Query() query: CursorPageQueryDto,
  ): Promise<AssignmentList> {
    return this.assignments.list(eventId, query);
  }

  @Post('events/:eventId/assignments')
  @RequirePermission('event:assign', { scope: 'event', from: 'params.eventId' })
  @ApiResponse(FORBIDDEN)
  @ApiResponse(NO_EVENT)
  @ApiResponse({ status: 409, description: 'That person already holds that responsibility.', type: ProblemDetailsDto })
  assign(
    @Actor() actor: User,
    @Param('eventId') eventId: string,
    @Body() body: AssignResponsibilityDto,
  ): Promise<Assignment> {
    return this.assignments.assign(actor, eventId, body);
  }

  // Nested under the event, and loaded by { id, eventId } in the service: a
  // permission scoped to one event cannot authorise a bare row id.
  @Delete('events/:eventId/assignments/:assignmentId')
  @HttpCode(204)
  @RequirePermission('event:assign', { scope: 'event', from: 'params.eventId' })
  @ApiResponse(FORBIDDEN)
  @ApiResponse({ status: 404, description: 'No such assignment on that event.', type: ProblemDetailsDto })
  removeAssignment(
    @Actor() actor: User,
    @Param('eventId') eventId: string,
    @Param('assignmentId') assignmentId: string,
    @Body() body: RemoveAssignmentDto,
  ): Promise<void> {
    return this.assignments.remove(actor, eventId, assignmentId, body);
  }
}
