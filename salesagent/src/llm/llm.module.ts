import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LLM_PROVIDER, EMBEDDING_PROVIDER, LLM_USAGE_TRACKER } from './llm.constants';
import { OpenAiLlmProvider } from './providers/openai/openai-llm.provider';
import { OpenAiEmbeddingProvider } from './providers/openai/openai-embedding.provider';
import { UsageTrackerService } from './services/usage-tracker.service';

/**
 * LlmModule wires the provider abstraction to concrete OpenAI implementations.
 *
 * To swap providers:
 *   1. Implement ILlmProvider / IEmbeddingProvider
 *   2. Change the `useClass` below — no consumer changes required
 *
 * Exported tokens are consumed via @Inject(LLM_PROVIDER) in other modules.
 */
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: LLM_PROVIDER,
      useClass: OpenAiLlmProvider,
    },
    {
      provide: EMBEDDING_PROVIDER,
      useClass: OpenAiEmbeddingProvider,
    },
    {
      provide: LLM_USAGE_TRACKER,
      useClass: UsageTrackerService,
    },
    // Register concrete classes for internal DI resolution
    OpenAiLlmProvider,
    OpenAiEmbeddingProvider,
    UsageTrackerService,
  ],
  exports: [LLM_PROVIDER, EMBEDDING_PROVIDER, LLM_USAGE_TRACKER],
})
export class LlmModule {}
