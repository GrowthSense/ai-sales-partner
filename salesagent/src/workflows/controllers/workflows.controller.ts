import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { WorkflowService, CreateWorkflowDto, UpdateWorkflowDto } from '../services/workflow.service';

class ListExecutionsQuery {
  status?: string;
  leadId?: string;
  workflowId?: string;
  page?: number;
  limit?: number;
}

/**
 * WorkflowsController
 *
 * Admin endpoints for managing workflow definitions and inspecting executions.
 * All routes require a valid admin JWT.
 *
 * GET    /workflows                       — list all workflows for tenant
 * POST   /workflows                       — create a workflow definition
 * GET    /workflows/:id                   — get workflow with steps
 * PATCH  /workflows/:id                   — update trigger, steps, or active state
 * DELETE /workflows/:id                   — delete workflow (pauses running executions)
 * GET    /workflows/executions            — list executions with filters
 * GET    /workflows/executions/:id        — get execution detail with logs
 */
@UseGuards(JwtAuthGuard)
@Controller('workflows')
export class WorkflowsController {
  constructor(private readonly workflowService: WorkflowService) {}

  // ─── Workflow CRUD ────────────────────────────────────────────────────────

  @Get()
  async list(@TenantId() tenantId: string) {
    return this.workflowService.findAll(tenantId);
  }

  @Post()
  async create(
    @Body() dto: CreateWorkflowDto,
    @TenantId() tenantId: string,
  ) {
    return this.workflowService.create(dto, tenantId);
  }

  @Get('executions')
  async listExecutions(
    @TenantId() tenantId: string,
    @Query() query: ListExecutionsQuery,
  ) {
    const [executions, total] = await this.workflowService.listExecutions(tenantId, {
      status: query.status,
      leadId: query.leadId,
      workflowId: query.workflowId,
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 20,
    });
    return { data: executions, total };
  }

  @Get('executions/:id')
  async getExecution(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
  ) {
    return this.workflowService.getExecution(id, tenantId);
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
  ) {
    return this.workflowService.findById(id, tenantId);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWorkflowDto,
    @TenantId() tenantId: string,
  ) {
    return this.workflowService.update(id, dto, tenantId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
  ) {
    await this.workflowService.delete(id, tenantId);
  }
}
