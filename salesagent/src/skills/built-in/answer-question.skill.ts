import { ISkill, SkillContext, SkillResult } from '../interfaces/skill.interface';

/**
 * AnswerQuestionSkill
 *
 * Signals to the orchestrator that the current user message needs a knowledge-
 * base lookup. In practice the orchestrator ALWAYS performs RAG retrieval before
 * calling the LLM; this skill is included as a tool so the LLM can explicitly
 * request retrieval for a follow-up query that differs from the original message.
 *
 * The LLM calls this when it needs to look up something specific (e.g. the user
 * asks a follow-up question mid-conversation that requires a different RAG query).
 * The orchestrator re-runs retrieval with the provided query and injects the
 * result into the next LLM call.
 */
export class AnswerQuestionSkill implements ISkill {
  readonly name = 'AnswerQuestion';
  readonly description =
    'Look up information from the company knowledge base to answer a specific question. ' +
    'Use this when you need product details, pricing, features, or policy information ' +
    'that you are not confident about from context.';

  readonly parameters = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The specific question or topic to look up in the knowledge base.',
      },
    },
    required: ['query'],
    additionalProperties: false,
  };

  async execute(
    args: { query: string },
    _ctx: SkillContext,
  ): Promise<SkillResult> {
    // The actual retrieval is handled by the orchestrator as a side-effect of
    // this skill being called. The orchestrator detects AnswerQuestion calls
    // and re-runs RAG with args.query before the next LLM iteration.
    return {
      success: true,
      data: {
        status: 'retrieval_requested',
        query: args.query,
      },
    };
  }
}
