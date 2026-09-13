import { Controller, Get, Header, Query, Res } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { eventExportQuerySchema } from '@majlis/contracts';
import type { Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { RequirePermission } from '../auth/require-permission.decorator';
import { ProblemDetailsDto } from '../common/problem/problem-details.dto';
import { attachment, exportCsv } from './csv';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- value import: Nest DI resolves this from design:paramtypes.
import { ReportingService } from './reporting.service';

class EventExportQueryDto extends createZodDto(eventExportQuerySchema) {}

/**
 * Every export answers with the same permission as the read it exports, not
 * with a blanket reporting one. `registrations.csv` and `attendance.csv`
 * carry attendee personal data, so they are `registration:read` scoped to
 * the event, which is what keeps spec 6.1's "Marketing does not see attendee
 * data" true of the file as well as of the screen.
 *
 * The scope id is read from `query.eventId`, so an Admin, who satisfies the
 * platform half without a scope, still has the query parameter validated by
 * the pipe afterwards and cannot ask for every event at once.
 */
@Controller('exports')
export class ExportsController {
  constructor(private readonly reporting: ReportingService) {}

  @Get('events.csv')
  @RequirePermission('report:read')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiResponse({ status: 403, description: 'You do not have permission to do that.', type: ProblemDetailsDto })
  async events(@Res({ passthrough: true }) res: Response): Promise<string> {
    const { headers, rows } = await this.reporting.eventRows();
    return this.send(res, 'events.csv', headers, rows);
  }

  @Get('registrations.csv')
  @RequirePermission('registration:read', { scope: 'event', from: 'query.eventId' })
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiResponse({ status: 403, description: 'You do not have permission to do that.', type: ProblemDetailsDto })
  async registrations(
    @Query() query: EventExportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const { headers, rows } = await this.reporting.registrationRows(query.eventId);
    return this.send(res, `registrations-${query.eventId}.csv`, headers, rows);
  }

  @Get('attendance.csv')
  @RequirePermission('registration:read', { scope: 'event', from: 'query.eventId' })
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiResponse({ status: 403, description: 'You do not have permission to do that.', type: ProblemDetailsDto })
  async attendance(
    @Query() query: EventExportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const { headers, rows } = await this.reporting.attendanceRows(query.eventId);
    return this.send(res, `attendance-${query.eventId}.csv`, headers, rows);
  }

  @Get('certificates.csv')
  @RequirePermission('registration:read', { scope: 'event', from: 'query.eventId' })
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiResponse({ status: 403, description: 'You do not have permission to do that.', type: ProblemDetailsDto })
  async certificates(
    @Query() query: EventExportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const { headers, rows } = await this.reporting.certificateRows(query.eventId);
    return this.send(res, `certificates-${query.eventId}.csv`, headers, rows);
  }

  private send(res: Response, filename: string, headers: string[], rows: unknown[][]): string {
    res.setHeader('Content-Disposition', attachment(filename));
    return exportCsv(headers, rows);
  }
}
