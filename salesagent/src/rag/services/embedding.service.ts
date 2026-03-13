import { Inject, Injectable, Logger } from '@nestjs/common';
import { EMBEDDING_PROVIDER } from '../../llm/llm.constants';
import { IEmbeddingProvider } from '../../llm/interfaces/embedding-provider.interface';

const BATCH_SIZE = 100; // OpenAI embeddings endpoint max inputs per request

/**
 * EmbeddingService — thin wrapper around IEmbeddingProvider.
 *
 * Provides domain-specific methods (embed a single query, batch embed for
 * ingestion) so consumers don't need to know about the embedding DTO shape.
 *
 * Default provider: OpenAI text-embedding-3-small (1536 dimensions).
 * Model is configured via EMBEDDING_MODEL env var and read by the provider.
 */
@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);

  constructor(
    @Inject(EMBEDDING_PROVIDER)
    private readonly provider: IEmbeddingProvider,
  ) {}

  /**
   * Embed a single query string for semantic search.
   * Returns a float32 array of length equal to provider.dimensions.
   */
  async embed(text: string): Promise<number[]> {
    const response = await this.provider.embed({
      model: this.provider.modelName,
      input: text,
    });
    return response.embeddings[0];
  }

  /**
   * Batch embed multiple texts (e.g. knowledge chunk content during ingestion).
   * Splits into batches of BATCH_SIZE to stay within API limits.
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      this.logger.debug(`Embedding batch ${i / BATCH_SIZE + 1}: ${batch.length} texts`);

      const response = await this.provider.embed({
        model: this.provider.modelName,
        input: batch,
      });

      results.push(...response.embeddings);
    }

    return results;
  }

  get modelName(): string {
    return this.provider.modelName;
  }

  get dimensions(): number {
    return this.provider.dimensions;
  }
}
