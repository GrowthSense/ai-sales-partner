import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { IEmbeddingProvider } from '../../interfaces/embedding-provider.interface';
import { EmbeddingRequest, EmbeddingResponse } from '../../dto/llm.dto';

/**
 * OpenAI implementation of IEmbeddingProvider.
 *
 * Default model: text-embedding-3-small @ 1536 dimensions.
 *   - 5× cheaper than text-embedding-3-large
 *   - ~3% MTEB benchmark difference for retrieval tasks
 *   - Upgrade path: re-embed all chunks with text-embedding-3-large; no schema change needed
 *
 * Batching: pass multiple strings in request.input to amortise API round-trips.
 * The OpenAI embeddings endpoint accepts up to 2048 inputs per request.
 */
@Injectable()
export class OpenAiEmbeddingProvider implements IEmbeddingProvider {
  readonly providerName = 'openai';
  readonly modelName: string;
  readonly dimensions: number;

  private readonly client: OpenAI;
  private readonly logger = new Logger(OpenAiEmbeddingProvider.name);
  private readonly useOpenRouter: boolean;

  constructor(private readonly config: ConfigService) {
    const openRouterKey = this.config.get<string>('OPENROUTER_API_KEY');
    this.useOpenRouter = !!openRouterKey;

    // OpenRouter supports embeddings at https://openrouter.ai/api/v1/embeddings.
    // When OPENROUTER_API_KEY is set, route embeddings through OpenRouter too.
    this.client = new OpenAI({
      apiKey: openRouterKey || this.config.getOrThrow<string>('OPENAI_API_KEY'),
      baseURL: openRouterKey ? 'https://openrouter.ai/api/v1' : undefined,
      maxRetries: 3,
      timeout: 30_000,
      defaultHeaders: openRouterKey
        ? { 'HTTP-Referer': 'https://salesagent.local', 'X-Title': 'Salesagent' }
        : undefined,
    });

    // Use OpenRouter-namespaced model when routing through OpenRouter
    const defaultEmbedModel = openRouterKey
      ? 'openai/text-embedding-3-small'
      : 'text-embedding-3-small';
    this.modelName = this.config.get<string>('OPENAI_EMBEDDING_MODEL', defaultEmbedModel);
    this.dimensions = this.config.get<number>('OPENAI_EMBEDDING_DIMENSIONS', 1536);
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    try {
      const response = await this.client.embeddings.create({
        model: request.model ?? this.modelName,
        input: request.input,
        dimensions: request.dimensions ?? this.dimensions,
      });

      return {
        model: response.model,
        embeddings: response.data
          .sort((a, b) => a.index - b.index)
          .map((item) => item.embedding),
        usage: {
          promptTokens: response.usage.prompt_tokens,
          totalTokens: response.usage.total_tokens,
        },
      };
    } catch (err: any) {
      // When only OpenRouter is available, embedding calls fail.
      // Return zero-vectors so the app stays functional (RAG is skipped).
      this.logger.warn(
        `Embedding failed (${err?.status ?? 'unknown'}) — returning zero-vectors. ` +
        `RAG retrieval will be skipped. Add a valid OPENAI_API_KEY for full RAG support.`,
      );
      const inputs = Array.isArray(request.input) ? request.input : [request.input];
      const dims = request.dimensions ?? this.dimensions;
      return {
        model: request.model ?? this.modelName,
        embeddings: inputs.map(() => new Array(dims).fill(0)),
        usage: { promptTokens: 0, totalTokens: 0 },
      };
    }
  }
}
