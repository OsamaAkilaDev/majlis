import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import {
  attendanceListQuerySchema,
  correctAttendanceBodySchema,
  manualCheckInBodySchema,
  scanBodySchema,
  type AttendancePage,
  type CheckInResult,
} from '@majlis/contracts';
import { createZodDto } from 'nestjs-zod';
import { Actor } from '../auth/actor.decorator';
import { RequirePermission } from '../auth/require-permission.decorator';
import { ProblemDetailsDto } from '../common/problem/problem-details.dto';
import type { User } from '../generated/prisma/client';
import { AttendanceService } from './attendance.service';

class ScanDto extends createZodDto(scanBodySchema) {}
class ManualCheckInDto extends createZodDto(manualCheckInBodySchema) {}
class CorrectAttendanceDto extends createZodDto(correctAttendanceBodySchema) {}
class AttendanceListQueryDto extends createZodDto(attendanceListQuerySchema) {}

@Controller()
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  /**
   * 200 for every outcome the operator has to read, including the refusals.
   * They are not client errors: the request was well-formed and authorised,
   * and the answer is what the scanner screen renders.
   */
  @Post('events/:eventId/check-in/scan')
  @HttpCode(200)
  @RequirePermission('attendance:scan', { scope: 'event', from: 'params.eventId' })
  @ApiResponse({ status: 403, description: 'You do not have permission to do that.', type: ProblemDetailsDto })
  @ApiResponse({ status: 404, description: 'No such event.', type: ProblemDetailsDto })
  scan(
    @Actor() actor: User,
    @Param('eventId') eventId: string,
    @Body() body: ScanDto,
  ): Promise<CheckInResult> {
    return this.attendance.scan(actor, eventId, body);
  }

  @Post('events/:eventId/check-in/manual')
  @HttpCode(200)
  @RequirePermission('attendance:scan', { scope: 'event', from: 'params.eventId' })
  @ApiResponse({ status: 403, description: 'You do not have permission to do that.', type: ProblemDetailsDto })
  @ApiResponse({ status: 404, description: 'No such event.', type: ProblemDetailsDto })
  manual(
    @Actor() actor: User,
    @Param('eventId') eventId: string,
    @Body() body: ManualCheckInDto,
  ): Promise<CheckInResult> {
    return this.attendance.manual(actor, eventId, body);
  }

  // Attendee personal data in bulk, so `registration:read` rather than
  // `attendance:scan`: spec 6.1 excludes Marketing and CTO from it.
  @Get('events/:eventId/attendance')
  @RequirePermission('registration:read', { scope: 'event', from: 'params.eventId' })
  @ApiResponse({ status: 403, description: 'You do not have permission to do that.', type: ProblemDetailsDto })
  roster(
    @Param('eventId') eventId: string,
    @Query() query: AttendanceListQueryDto,
  ): Promise<AttendancePage> {
    return this.attendance.roster(eventId, query);
  }

  @Patch('events/:eventId/attendance/:registrationId')
  @HttpCode(204)
  @RequirePermission('attendance:correct', { scope: 'event', from: 'params.eventId' })
  @ApiResponse({ status: 403, description: 'You do not have permission to do that.', type: ProblemDetailsDto })
  @ApiResponse({ status: 404, description: 'No such registration for that event.', type: ProblemDetailsDto })
  @ApiResponse({ status: 422, description: 'The correction window has closed, or attendance is locked.', type: ProblemDetailsDto })
  correct(
    @Actor() actor: User,
    @Param('eventId') eventId: string,
    @Param('registrationId') registrationId: string,
    @Body() body: CorrectAttendanceDto,
  ): Promise<void> {
    return this.attendance.correct(actor, eventId, registrationId, body);
  }
}
