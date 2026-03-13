import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IsEnum, IsOptional, IsString, IsBoolean, IsArray, ValidateNested, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

import { Workflow } from '../entities/workflow.entity';
import { WorkflowExecution } from '../entities/workflow-execution.entity';
import {
  WorkflowTrigger,
  WorkflowStep,
  WorkflowStepType,
} from '../interfaces/workflow-step.interface';

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export class WorkflowStepDto implements WorkflowStep {
  @IsEnum(WorkflowStepType)
  type: WorkflowStepType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  delayHours?: number;

  @IsOptional()
  config: Record<string, unknown>;
}

export class CreateWorkflowDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(WorkflowTrigger)
  trigger: WorkflowTrigger;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkflowStepDto)
  steps: WorkflowStepDto[];
}

export class UpdateWorkflowDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(WorkflowTrigger)
  trigger?: WorkflowTrigger;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkflowStepDto)
  steps?: WorkflowStepDto[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export interface ListExecutionsFilter {
  status?: string;
  leadId?: string;
  workflowId?: string;
  page?: number;
  limit?: number;
}

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * WorkflowService — CRUD for Workflow definitions and read access to executions.
 *
 * Execution lifecycle (write path) is managed by WorkflowTriggerService + FollowUpWorker.
 * This service owns the admin-facing read/write API for definitions.
 */
@Injectable()
export class WorkflowService {
  private readonly logger = new Logger(WorkflowService.name);

  constructor(
    @InjectRepository(Workflow)
    private readonly workflowRepo: Repository<Workflow>,

    @InjectRepository(WorkflowExecution)
    private readonly executionRepo: Repository<WorkflowExecution>,
  ) {}

  // ─── Workflow CRUD ────────────────────────────────────────────────────────

  async create(dto: CreateWorkflowDto, tenantId: string): Promise<Workflow> {
    const workflow = this.workflowRepo.create({
      tenantId,
      name: dto.name,
      description: dto.description ?? null,
      trigger: dto.trigger,
      steps: dto.steps ?? [],
      isActive: true,
    });

    const saved = await this.workflowRepo.save(workflow);
    this.logger.log(`Workflow created: id=${saved.id} trigger=${saved.trigger} tenantId=${tenantId}`);
    return saved;
  }

  async findAll(tenantId: string): Promise<Workflow[]> {
    return this.workflowRepo.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
    });
  }

  async findById(id: string, tenantId: string): Promise<Workflow> {
    const workflow = await this.workflowRepo.findOne({ where: { id, tenantId } });
    if (!workflow) throw new NotFoundException(`Workflow ${id} not found`);
    return workflow;
  }

  /** Find all active workflows for a tenant matching a specific trigger. */
  async findByTrigger(tenantId: string, trigger: WorkflowTrigger): Promise<Workflow[]> {
    return this.workflowRepo.find({
      where: { tenantId, trigger, isActive: true },
    });
  }

  async update(id: string, dto: UpdateWorkflowDto, tenantId: string): Promise<Workflow> {
    const workflow = await this.findById(id, tenantId);

    if (dto.name !== undefined) workflow.name = dto.name;
    if (dto.description !== undefined) workflow.description = dto.description ?? null;
    if (dto.trigger !== undefined) workflow.trigger = dto.trigger;
    if (dto.steps !== undefined) workflow.steps = dto.steps;
    if (dto.isActive !== undefined) workflow.isActive = dto.isActive;

    return this.workflowRepo.save(workflow);
  }

  async delete(id: string, tenantId: string): Promise<void> {
    const workflow = await this.findById(id, tenantId);
    await this.workflowRepo.remove(workflow);
  }

  // ─── Execution read access ────────────────────────────────────────────────

  async listExecutions(
    tenantId: string,
    filter: ListExecutionsFilter = {},
  ): Promise<[WorkflowExecution[], number]> {
    const { status, leadId, workflowId, page = 1, limit = 20 } = filter;

    const qb = this.executionRepo
      .createQueryBuilder('e')
      .where('e.tenant_id = :tenantId', { tenantId })
      .orderBy('e.started_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (status) qb.andWhere('e.status = :status', { status });
    if (leadId) qb.andWhere('e.lead_id = :leadId', { leadId });
    if (workflowId) qb.andWhere('e.workflow_id = :workflowId', { workflowId });

    return qb.getManyAndCount();
  }

  async getExecution(id: string, tenantId: string): Promise<WorkflowExecution> {
    const execution = await this.executionRepo.findOne({
      where: { id, tenantId },
      relations: ['workflow'],
    });
    if (!execution) throw new NotFoundException(`WorkflowExecution ${id} not found`);
    return execution;
  }
}
