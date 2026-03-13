import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ISkill } from '../interfaces/skill.interface';
import { LlmTool } from '../../llm/dto/llm.dto';

// Built-in skill imports — each file will export a concrete class
// implementing ISkill. They are NOT NestJS providers (they carry no state);
// they are plain classes instantiated here and held in the registry map.
import { AnswerQuestionSkill } from '../built-in/answer-question.skill';
import { CaptureContactSkill } from '../built-in/capture-contact.skill';
import { QualifyLeadSkill } from '../built-in/qualify-lead.skill';
import { RecommendServiceSkill } from '../built-in/recommend-service.skill';
import { ScheduleDemoSkill } from '../built-in/schedule-demo.skill';
import { PushToCrmSkill } from '../built-in/push-to-crm.skill';
import { SendFollowUpSkill } from '../built-in/send-follow-up.skill';
import { HandoffToHumanSkill } from '../built-in/handoff-to-human.skill';
import { TransitionStageSkill } from '../built-in/transition-stage.skill';

/**
 * SkillRegistryService
 *
 * Central registry for all skills available to the agent:
 *  - Built-in skills registered at module init
 *  - MCP tools registered dynamically by McpRegistryService
 *
 * The orchestrator calls getEnabled(agent.enabledSkills) to get the
 * filtered set for a specific agent, then toOpenAiTools() to format
 * them for the LLM tools array.
 */
@Injectable()
export class SkillRegistryService implements OnModuleInit {
  private readonly logger = new Logger(SkillRegistryService.name);
  private readonly registry = new Map<string, ISkill>();

  onModuleInit(): void {
    const builtIns: ISkill[] = [
      new AnswerQuestionSkill(),
      new CaptureContactSkill(),
      new QualifyLeadSkill(),
      new RecommendServiceSkill(),
      new ScheduleDemoSkill(),
      new PushToCrmSkill(),
      new SendFollowUpSkill(),
      new HandoffToHumanSkill(),
      new TransitionStageSkill(),
    ];

    for (const skill of builtIns) {
      this.register(skill);
    }

    this.logger.log(`Registered ${this.registry.size} built-in skills`);
  }

  /**
   * Register a skill. Overwrites if a skill with the same name already exists.
   * Called for built-ins at startup and for MCP tools on dynamic registration.
   */
  register(skill: ISkill): void {
    this.registry.set(skill.name, skill);
    this.logger.debug(`Skill registered: ${skill.name}`);
  }

  /**
   * Deregister a skill by name.
   * Called by McpRegistryService when an MCP server goes offline.
   */
  deregister(name: string): void {
    this.registry.delete(name);
    this.logger.debug(`Skill deregistered: ${name}`);
  }

  getAll(): ISkill[] {
    return [...this.registry.values()];
  }

  getByName(name: string): ISkill | undefined {
    return this.registry.get(name);
  }

  /**
   * Return only the skills whose names appear in enabledSkills.
   * Used by the orchestrator to filter by Agent.enabledSkills.
   */
  getEnabled(enabledNames: string[]): ISkill[] {
    return enabledNames
      .map((name) => this.registry.get(name))
      .filter((s): s is ISkill => s !== undefined);
  }

  /**
   * Convert ISkill[] to the OpenAI tools array format.
   * Passed directly to LlmChatRequest.tools.
   */
  toOpenAiTools(skills: ISkill[]): LlmTool[] {
    return skills.map((skill) => ({
      type: 'function',
      function: {
        name: skill.name,
        description: skill.description,
        parameters: skill.parameters as unknown as LlmTool['function']['parameters'],
      },
    }));
  }
}
