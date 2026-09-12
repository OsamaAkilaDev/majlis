import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import {
  createDepartmentBodySchema,
  cursorPageQuerySchema,
  patchDepartmentBodySchema,
  type Department,
  type DepartmentPage,
} from '@majlis/contracts';
import { createZodDto } from 'nestjs-zod';
import { Actor } from '../auth/actor.decorator';
import { RequirePermission } from '../auth/require-permission.decorator';
import { ProblemDetailsDto } from '../common/problem/problem-details.dto';
import type { User } from '../generated/prisma/client';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- must stay a value import: Nest's constructor DI resolves this provider from the emitted `design:paramtypes` metadata, which needs a real runtime reference.
import { DepartmentsService } from './departments.service';

class CreateDepartmentDto extends createZodDto(createDepartmentBodySchema) {}
class PatchDepartmentDto extends createZodDto(patchDepartmentBodySchema) {}
class DepartmentsQueryDto extends createZodDto(cursorPageQuerySchema) {}

@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @Get()
  @ApiResponse({ status: 401, description: 'Not signed in.', type: ProblemDetailsDto })
  list(@Query() query: DepartmentsQueryDto): Promise<DepartmentPage> {
    return this.departments.list(query);
  }

  @Post()
  @RequirePermission('department:manage')
  @ApiResponse({ status: 403, description: 'You do not have permission to do that.', type: ProblemDetailsDto })
  @ApiResponse({ status: 409, description: 'A department with that name or code already exists.', type: ProblemDetailsDto })
  create(@Actor() actor: User, @Body() body: CreateDepartmentDto): Promise<Department> {
    return this.departments.create(actor, body);
  }

  @Patch(':id')
  @RequirePermission('department:manage')
  @ApiResponse({ status: 403, description: 'You do not have permission to do that.', type: ProblemDetailsDto })
  @ApiResponse({ status: 404, description: 'No such department.', type: ProblemDetailsDto })
  @ApiResponse({ status: 409, description: 'A department with that name or code already exists.', type: ProblemDetailsDto })
  update(@Actor() actor: User, @Param('id') id: string, @Body() body: PatchDepartmentDto): Promise<Department> {
    return this.departments.update(actor, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('department:manage')
  @ApiResponse({ status: 403, description: 'You do not have permission to do that.', type: ProblemDetailsDto })
  @ApiResponse({ status: 404, description: 'No such department.', type: ProblemDetailsDto })
  @ApiResponse({ status: 409, description: 'That department still has clubs.', type: ProblemDetailsDto })
  remove(@Actor() actor: User, @Param('id') id: string): Promise<void> {
    return this.departments.remove(actor, id);
  }
}
