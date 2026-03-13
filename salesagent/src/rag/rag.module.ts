import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { KnowledgeChunk } from '../knowledge/entities/knowledge-chunk.entity';
import { KnowledgeDocument } from '../knowledge/entities/knowledge-document.entity';

import { EmbeddingService } from './services/embedding.service';
import { RetrievalService } from './services/retrieval.service';
import { RerankService } from './services/rerank.service';
import { LlmModule } from '../llm/llm.module';

/**
 * RagModule — internal-only retrieval-augmented generation layer.
 *
 * No REST endpoints. Exports EmbeddingService, RetrievalService, and RerankService
 * for use by AgentsModule (retrieval at inference time) and
 * KnowledgeModule (ingestion pipeline + controller search endpoint).
 *
 * Retrieval strategy:
 *  1. Semantic search  (pgvector HNSW cosine, tenantId pre-filtered before ANN)
 *  2. Keyword search   (pg_trgm + tsvector ts_rank)
 *  3. RRF fusion       (k=60, merges both ranked lists)
 *  4. Optional rerank  (RerankService via LLM, skipped if latency > rerankTimeoutMs)
 *
 * LlmModule is imported to provide:
 *   EMBEDDING_PROVIDER  → EmbeddingService (OpenAI text-embedding-3-small)
 *   LLM_PROVIDER        → RerankService (single batch LLM call for relevance scoring)
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([KnowledgeChunk, KnowledgeDocument]),
    LlmModule, // provides EMBEDDING_PROVIDER for EmbeddingService
  ],
  providers: [EmbeddingService, RetrievalService, RerankService],
  exports: [EmbeddingService, RetrievalService, RerankService],
})
export class RagModule {}
