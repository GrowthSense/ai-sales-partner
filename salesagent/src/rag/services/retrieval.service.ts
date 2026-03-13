import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EmbeddingService } from './embedding.service';
import { RerankService } from './rerank.service';
import { RetrievalResult } from '../interfaces/retrieval-result.interface';

/**
 * RRF constant (k=60 is standard — dampens rank differences at the top).
 * Score = 1 / (k + rank_semantic) + 1 / (k + rank_keyword)
 */
const RRF_K = 60;

/**
 * RetrievalService — hybrid semantic + keyword search with RRF fusion.
 *
 * Retrieval strategy:
 *  1. Semantic search  : pgvector HNSW cosine ANN, tenantId-filtered first
 *  2. Keyword search   : pg_trgm similarity + ts_rank tsvector
 *  3. RRF fusion       : merge both ranked lists into a single score
 *  4. Optional rerank  : cross-encoder via RerankService if latency budget allows
 *
 * CRITICAL: tenantId filter is applied BEFORE the vector operator on every query.
 *   Correct:   WHERE tenant_id = $1 ORDER BY embedding <=> $2 LIMIT 20
 *   Wrong:     ORDER BY embedding <=> $2 WHERE tenant_id = $1 LIMIT 20
 *   The wrong form performs ANN across all tenants then filters — causing both
 *   cross-tenant data leakage AND poor recall.
 */
@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly embedding: EmbeddingService,
    private readonly reranker: RerankService,
  ) {}

  /**
   * Hybrid search: semantic + keyword, fused via Reciprocal Rank Fusion.
   *
   * @param query    Raw user query string (embedded internally)
   * @param tenantId Tenant isolation — always applied as pre-filter
   * @param topK     Final number of chunks to return after fusion + rerank
   * @param ragConfig Optional tuning from AgentConfig.ragConfig
   */
  async hybridSearch(
    query: string,
    tenantId: string,
    topK = 5,
    ragConfig?: {
      rerankEnabled?: boolean;
      rerankTimeoutMs?: number;
      hybridSearchWeight?: number; // 1 = pure semantic, 0 = pure keyword
    },
  ): Promise<RetrievalResult[]> {
    const candidateLimit = Math.max(topK * 4, 20); // over-fetch for fusion

    // Run both searches in parallel; semantic search may fail if pgvector is not installed
    const [semanticResults, keywordResults] = await Promise.all([
      this.semanticSearch(query, tenantId, candidateLimit).catch((err) => {
        this.logger.warn(`Semantic search unavailable (pgvector not installed?): ${err.message} — falling back to keyword-only`);
        return [] as RetrievalResult[];
      }),
      this.keywordSearch(query, tenantId, candidateLimit).catch((err) => {
        this.logger.warn(`Keyword search failed: ${err.message}`);
        return [] as RetrievalResult[];
      }),
    ]);

    // Fuse
    const fused = this.reciprocalRankFusion(semanticResults, keywordResults);

    // Optional rerank (skip if latency budget exceeded)
    const rerankEnabled = ragConfig?.rerankEnabled ?? true;
    const rerankTimeout = ragConfig?.rerankTimeoutMs ?? 300;

    let final = fused.slice(0, topK);

    if (rerankEnabled && fused.length > 1) {
      try {
        final = await Promise.race([
          this.reranker.rerank(query, fused.slice(0, 10), topK),
          new Promise<RetrievalResult[]>((_, reject) =>
            setTimeout(() => reject(new Error('rerank timeout')), rerankTimeout),
          ),
        ]);
      } catch {
        this.logger.debug('Rerank skipped (timeout or error) — using fused results');
        final = fused.slice(0, topK);
      }
    }

    this.logger.debug(
      `Retrieval: semantic=${semanticResults.length} keyword=${keywordResults.length} ` +
      `fused=${fused.length} returned=${final.length}`,
    );

    return final;
  }

  // ─── Semantic search (pgvector HNSW) ────────────────────────────────────

  private async semanticSearch(
    query: string,
    tenantId: string,
    limit: number,
  ): Promise<RetrievalResult[]> {
    const queryVector = await this.embedding.embed(query);
    const vectorStr = `[${queryVector.join(',')}]`;

    // The WHERE tenant_id = $1 clause runs BEFORE the ORDER BY with the vector
    // operator, leveraging the composite (tenant_id, ...) index on embeddings.
    const rows: Array<{
      chunk_id: string;
      document_id: string;
      content: string;
      document_title: string;
      source_url: string | null;
      page_number: number | null;
      section_heading: string | null;
      chunk_index: number;
      distance: number;
    }> = await this.dataSource.query(
      `
      SELECT
        kc.id           AS chunk_id,
        kc.document_id  AS document_id,
        kc.content      AS content,
        kd.title        AS document_title,
        kc.metadata->>'sourceUrl'       AS source_url,
        (kc.metadata->>'pageNumber')::int AS page_number,
        kc.metadata->>'sectionHeading' AS section_heading,
        (kc.metadata->>'chunkIndex')::int AS chunk_index,
        e.vector::vector <=> $2::vector  AS distance
      FROM knowledge_chunks kc
      JOIN knowledge_documents kd ON kd.id = kc.document_id
      JOIN embeddings e ON e.chunk_id = kc.id
      WHERE kc.tenant_id = $1
        AND kd.status = 'ready'
      ORDER BY e.vector::vector <=> $2::vector
      LIMIT $3
      `,
      [tenantId, vectorStr, limit],
    );

    return rows.map((row, rank) => ({
      chunkId: row.chunk_id,
      documentId: row.document_id,
      content: row.content,
      metadata: {
        documentTitle: row.document_title,
        sourceUrl: row.source_url ?? undefined,
        pageNumber: row.page_number ?? undefined,
        sectionHeading: row.section_heading ?? undefined,
        chunkIndex: row.chunk_index ?? 0,
      },
      semanticScore: 1 - row.distance, // convert distance → similarity
      keywordScore: 0,
      fusedScore: 0,
      _semanticRank: rank,
    }));
  }

  // ─── Keyword search (tsvector ts_rank with OR-based matching) ────────────

  /**
   * Build a tsquery that ORs individual tokens together.
   * plainto_tsquery ANDs all terms — too strict for conversational queries like
   * "what plans do you offer" (requires both 'plan' AND 'offer' to appear).
   * This OR approach returns chunks that contain ANY of the meaningful words.
   */
  private buildOrTsQuery(query: string): string {
    // Split on whitespace, strip punctuation, lowercase
    const tokens = query
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2); // skip very short words (stop words mostly)

    if (tokens.length === 0) return query;
    // Wrap each token as a prefix tsquery term and OR them together
    return tokens.map((t) => `${t}:*`).join(' | ');
  }

  private async keywordSearch(
    query: string,
    tenantId: string,
    limit: number,
  ): Promise<RetrievalResult[]> {
    const tsQuery = this.buildOrTsQuery(query);

    const rows: Array<{
      chunk_id: string;
      document_id: string;
      content: string;
      document_title: string;
      source_url: string | null;
      page_number: number | null;
      section_heading: string | null;
      chunk_index: number;
      ts_score: number;
    }> = await this.dataSource.query(
      `
      SELECT
        kc.id           AS chunk_id,
        kc.document_id  AS document_id,
        kc.content      AS content,
        kd.title        AS document_title,
        kc.metadata->>'sourceUrl'       AS source_url,
        (kc.metadata->>'pageNumber')::int AS page_number,
        kc.metadata->>'sectionHeading' AS section_heading,
        (kc.metadata->>'chunkIndex')::int AS chunk_index,
        ts_rank(
          to_tsvector('english', kc.content),
          to_tsquery('english', $2)
        ) AS ts_score
      FROM knowledge_chunks kc
      JOIN knowledge_documents kd ON kd.id = kc.document_id
      WHERE kc.tenant_id = $1
        AND kd.status = 'ready'
        AND to_tsvector('english', kc.content) @@ to_tsquery('english', $2)
      ORDER BY ts_score DESC
      LIMIT $3
      `,
      [tenantId, tsQuery, limit],
    );

    return rows.map((row, rank) => ({
      chunkId: row.chunk_id,
      documentId: row.document_id,
      content: row.content,
      metadata: {
        documentTitle: row.document_title,
        sourceUrl: row.source_url ?? undefined,
        pageNumber: row.page_number ?? undefined,
        sectionHeading: row.section_heading ?? undefined,
        chunkIndex: row.chunk_index ?? 0,
      },
      semanticScore: 0,
      keywordScore: row.ts_score,
      fusedScore: 0,
      _keywordRank: rank,
    }));
  }

  // ─── Reciprocal Rank Fusion ───────────────────────────────────────────────

  private reciprocalRankFusion(
    semantic: Array<RetrievalResult & { _semanticRank?: number }>,
    keyword: Array<RetrievalResult & { _keywordRank?: number }>,
  ): RetrievalResult[] {
    const scores = new Map<string, { result: RetrievalResult; fused: number }>();

    for (const item of semantic) {
      const rank = (item as any)._semanticRank ?? 0;
      const score = 1 / (RRF_K + rank + 1);
      scores.set(item.chunkId, {
        result: { ...item, semanticScore: item.semanticScore },
        fused: score,
      });
    }

    for (const item of keyword) {
      const rank = (item as any)._keywordRank ?? 0;
      const score = 1 / (RRF_K + rank + 1);
      const existing = scores.get(item.chunkId);
      if (existing) {
        existing.fused += score;
        existing.result.keywordScore = item.keywordScore;
      } else {
        scores.set(item.chunkId, {
          result: { ...item, semanticScore: 0 },
          fused: score,
        });
      }
    }

    return [...scores.values()]
      .sort((a, b) => b.fused - a.fused)
      .map(({ result, fused }) => ({ ...result, fusedScore: fused }));
  }
}
