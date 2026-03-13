import { EmbeddingRequest, EmbeddingResponse } from '../dto/llm.dto';

/**
 * Embedding provider abstraction.
 * Default implementation uses OpenAI text-embedding-3-small.
 * Bound to EMBEDDING_PROVIDER injection token.
 */
export interface IEmbeddingProvider {
  /**
   * Generate embeddings for one or more input strings.
   * Batching multiple inputs in a single call is more efficient.
   */
  embed(request: EmbeddingRequest): Promise<EmbeddingResponse>;

  /**
   * Dimensions of the embedding vectors produced.
   * Stored alongside the model name to validate dimension compatibility.
   */
  readonly dimensions: number;

  /**
   * Model identifier — stored on the Embedding entity for multi-model support.
   * e.g. 'text-embedding-3-small', 'text-embedding-3-large'
   */
  readonly modelName: string;

  /**
   * Provider identifier — used in usage tracking records.
   */
  readonly providerName: string;
}
