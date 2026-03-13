import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConversationStage } from '../../common/enums';
import { Conversation } from '../../conversations/entities/conversation.entity';
import { Lead } from '../../leads/entities/lead.entity';

/**
 * Directed graph of allowed stage transitions.
 * The LLM requests a transition via the TransitionStage skill;
 * this service is the authoritative gatekeeper — it validates the request
 * against the allowed graph before writing to the DB.
 *
 * The LLM signals intent, but never directly drives state.
 */
const ALLOWED_TRANSITIONS: Record<ConversationStage, ConversationStage[]> = {
  [ConversationStage.GREETING]: [
    ConversationStage.DISCOVERY,
    ConversationStage.FOLLOW_UP,
  ],
  [ConversationStage.DISCOVERY]: [
    ConversationStage.QUALIFICATION,
    ConversationStage.FOLLOW_UP,
  ],
  [ConversationStage.QUALIFICATION]: [
    ConversationStage.RECOMMENDATION,
    ConversationStage.FOLLOW_UP,
  ],
  [ConversationStage.RECOMMENDATION]: [
    ConversationStage.OBJECTION_HANDLING,
    ConversationStage.CONVERSION,
    ConversationStage.FOLLOW_UP,
  ],
  [ConversationStage.OBJECTION_HANDLING]: [
    ConversationStage.RECOMMENDATION,
    ConversationStage.CONVERSION,
    ConversationStage.FOLLOW_UP,
  ],
  [ConversationStage.CONVERSION]: [
    ConversationStage.SCHEDULING,
    ConversationStage.FOLLOW_UP,
  ],
  [ConversationStage.SCHEDULING]: [
    ConversationStage.FOLLOW_UP,
  ],
  [ConversationStage.FOLLOW_UP]: [],
};

/**
 * Minimum BANT score required before the agent can advance to RECOMMENDATION.
 * Prevents premature pitching before understanding the visitor's situation.
 */
const MIN_SCORE_FOR_RECOMMENDATION = 25;

export interface TransitionResult {
  transitioned: boolean;
  newStage: ConversationStage;
  reason: string;
}

@Injectable()
export class StageStateMachineService {
  private readonly logger = new Logger(StageStateMachineService.name);

  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,
  ) {}

  /**
   * Check if a stage transition is structurally allowed by the graph.
   */
  canTransition(from: ConversationStage, to: ConversationStage): boolean {
    return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
  }

  /**
   * Validate and apply a stage transition requested by the LLM.
   *
   * Additional guards beyond the graph:
   * - QUALIFICATION → RECOMMENDATION requires minimum BANT score
   * - Terminal stage (follow_up) cannot transition further
   *
   * Does NOT persist — the orchestrator saves the conversation after the full
   * update pass to batch all DB writes into one round-trip.
   */
  tryTransition(
    conversation: Conversation,
    requested: ConversationStage,
    lead?: Lead | null,
  ): TransitionResult {
    const from = conversation.currentStage;

    if (from === requested) {
      return { transitioned: false, newStage: from, reason: 'already in requested stage' };
    }

    if (!this.canTransition(from, requested)) {
      this.logger.warn(
        `Invalid transition: ${from} → ${requested} (conv ${conversation.id})`,
      );
      return {
        transitioned: false,
        newStage: from,
        reason: `transition ${from} → ${requested} not in allowed graph`,
      };
    }

    // Guard: must have some BANT signal before recommending
    if (
      requested === ConversationStage.RECOMMENDATION &&
      lead &&
      (lead.score ?? 0) < MIN_SCORE_FOR_RECOMMENDATION
    ) {
      this.logger.debug(
        `Blocking → RECOMMENDATION: BANT score ${lead.score} < ${MIN_SCORE_FOR_RECOMMENDATION}`,
      );
      return {
        transitioned: false,
        newStage: from,
        reason: `BANT score ${lead.score} too low — qualify further before recommending`,
      };
    }

    this.logger.log(`Stage: ${from} → ${requested} (conv ${conversation.id})`);
    return { transitioned: true, newStage: requested, reason: 'ok' };
  }

  /**
   * Force a direct jump to FOLLOW_UP regardless of current stage.
   * Used when: visitor disconnects, inactivity timeout, HandoffToHuman skill fires.
   */
  forceFollowUp(conversation: Conversation): TransitionResult {
    if (conversation.currentStage === ConversationStage.FOLLOW_UP) {
      return { transitioned: false, newStage: ConversationStage.FOLLOW_UP, reason: 'already in follow_up' };
    }
    this.logger.log(`Force → FOLLOW_UP (conv ${conversation.id})`);
    return { transitioned: true, newStage: ConversationStage.FOLLOW_UP, reason: 'forced' };
  }

  /**
   * Infer the most appropriate stage from lead data when no explicit
   * TransitionStage skill was called. Acts as a safety net so stage always
   * reflects the conversation reality after skill side-effects accumulate.
   */
  inferStageFromLead(current: ConversationStage, lead: Lead | null): ConversationStage {
    if (!lead) return current;

    const score = lead.score ?? 0;

    if (current === ConversationStage.GREETING && (lead.email || lead.firstName)) {
      return ConversationStage.DISCOVERY;
    }
    if (current === ConversationStage.DISCOVERY && score >= MIN_SCORE_FOR_RECOMMENDATION) {
      return ConversationStage.QUALIFICATION;
    }

    return current;
  }

  /**
   * Persist a confirmed stage update to the conversation record.
   * Called by the orchestrator at the end of the update pass.
   */
  async persistTransition(conversationId: string, newStage: ConversationStage): Promise<void> {
    await this.conversationRepo.update(conversationId, { currentStage: newStage });
  }
}
