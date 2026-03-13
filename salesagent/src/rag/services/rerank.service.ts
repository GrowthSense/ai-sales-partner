import { Inject, Injectable, Logger } from '@nestjs/common';
import { LLM_PROVIDER } from '../../llm/llm.constants';
import { ILlmProvider } from '../../llm/interfaces/llm-provider.interface';
import { RetrievalResult } from '../interfaces/retrieval-result.interface';

/**
 * RerankService — cross-encoder reranking of hybrid search candidates.
 *
 * Applies after RRF fusion: receives top-10 pre-filtered chunks and scores
 * each one for relevance to the query using the LLM.
 *
 * Strategy: single LLM call asking the model to rate each chunk 0-10 in
 * JSON format. This is ~5x cheaper and faster than individual calls per chunk.
 * Skipped automatically by RetrievalService when latency budget is exceeded.
 *
 * Fallback: if the LLM call fails or returns malformed JSON, the original
 * RRF-ranked order is preserved unchanged.
 */
@Injectable()
export class RerankService {
  private readonly logger = new Logger(RerankService.name);

  constructor(
    @Inject(LLM_PROVIDER)
    private readonly llm: ILlmProvider,
  ) {}

  /**
   * Rerank a list of candidate chunks against a query.
   * Returns at most `topK` chunks sorted by rerank score DESC.
   *
   * @param query     Original user query
   * @param candidates Chunks from hybrid search (typically 10)
   * @param topK       Max chunks to return (typically 5)
   */
  async rerank(
    query: string,
    candidates: RetrievalResult[],
    topK = 5,
  ): Promise<RetrievalResult[]> {
    if (candidates.length === 0) return [];
    if (candidates.length === 1) {
      return [{ ...candidates[0], rerankScore: 1.0 }];
    }

    const scores = await this.scoreWithLlm(query, candidates);

    return candidates
      .map((chunk, i) => ({ ...chunk, rerankScore: scores[i] ?? 0 }))
      .sort((a, b) => (b.rerankScore ?? 0) - (a.rerankScore ?? 0))
      .slice(0, topK);
  }

  // ─── LLM scoring ─────────────────────────────────────────────────────────

  /**
   * Single LLM call: ask the model to rate the relevance of each chunk
   * to the query on a scale of 0-10, returned as a JSON array.
   *
   * System prompt is minimal to minimise token usage. Uses a cheap/fast
   * model (gpt-4o-mini) since this is a classification task, not generation.
   */
  private async scoreWithLlm(
    query: string,
    candidates: RetrievalResult[],
  ): Promise<number[]> {
    const chunksBlock = candidates
      .map((c, i) => `[${i}] ${c.content.slice(0, 300)}`)
      .join('\n\n');

    const prompt = `You are a relevance scorer. Rate how relevant each text chunk is to the query.
Return ONLY a JSON array of ${candidates.length} numbers from 0.0 to 1.0, one per chunk, in order.

Query: "${query}"

Chunks:
${chunksBlock}

JSON scores array:`;

    try {
      const response = await this.llm.complete({
        model: 'gpt-4o-mini',
        temperature: 0,
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = response.content?.trim() ?? '';

      // Extract JSON array from the response
      const match = text.match(/\[[\d.,\s]+\]/);
      if (!match) {
        this.logger.debug('Rerank: no JSON array in LLM response — using original order');
        return candidates.map(() => 0);
      }

      const scores = JSON.parse(match[0]) as unknown[];
      if (!Array.isArray(scores) || scores.length !== candidates.length) {
        return candidates.map(() => 0);
      }

      return scores.map((s) => {
        const n = typeof s === 'number' ? s : parseFloat(String(s));
        return isNaN(n) ? 0 : Math.max(0, Math.min(1, n));
      });
    } catch (err: unknown) {
      this.logger.debug(
        `Rerank LLM call failed: ${err instanceof Error ? err.message : err} — using original order`,
      );
      return candidates.map(() => 0);
    }
  }
}
