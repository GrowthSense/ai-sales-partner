import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { MulterModule } from '@nestjs/platform-express';

import { KnowledgeDocument } from './entities/knowledge-document.entity';
import { KnowledgeChunk } from './entities/knowledge-chunk.entity';
import { Embedding } from './entities/embedding.entity';

import { DocumentService } from './services/document.service';
import { ChunkingService } from './services/chunking.service';
import { IngestionService } from './services/ingestion.service';
import { RagIngestWorker } from './workers/rag-ingest.worker';
import { KnowledgeController } from './controllers/knowledge.controller';

import { RagModule } from '../rag/rag.module';
import { QUEUE_NAMES } from '../common/types/queue-jobs.types';

/**
 * KnowledgeModule
 *
 * Manages the tenant knowledge base: document ingestion, chunking,
 * embedding storage, and retrieval.
 *
 * Ingestion pipeline (async, BullMQ-driven):
 *   POST /knowledge/documents/upload|url|text
 *     → DocumentService.create*() → KnowledgeDocument record (status: pending)
 *     → Enqueues RagIngestJob on 'rag-ingest' queue
 *     → RagIngestWorker.process()
 *       → IngestionService.ingest()
 *         → Parser (pdf-parse | mammoth | cheerio | fetch)
 *         → ChunkingService.chunk() (512 tokens, 100 overlap)
 *         → EmbeddingService.embedBatch() (OpenAI text-embedding-3-small)
 *         → Bulk INSERT KnowledgeChunk + Embedding (transaction)
 *         → DocumentService.markReady()
 *
 * Retrieval (synchronous, in-request):
 *   AgentOrchestratorService.run()
 *     → RetrievalService.hybridSearch()
 *       → Semantic (pgvector HNSW, tenant pre-filtered)
 *       → Keyword (pg_trgm + tsvector ts_rank)
 *       → RRF fusion (k=60)
 *       → Optional rerank (RerankService, 300ms budget)
 *
 * pgvector indexes (must be applied in migrations):
 *   CREATE INDEX idx_embeddings_hnsw ON embeddings
 *     USING hnsw (vector vector_cosine_ops) WITH (m=16, ef_construction=64);
 *   CREATE INDEX idx_chunks_content_gin ON knowledge_chunks
 *     USING gin(to_tsvector('english', content));
 *
 * Peer dependencies (install separately):
 *   npm install pdf-parse mammoth cheerio
 *   npm install --save-dev @types/pdf-parse @types/mammoth @types/cheerio
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([KnowledgeDocument, KnowledgeChunk, Embedding]),

    // Register the rag-ingest queue (consumed by RagIngestWorker)
    BullModule.registerQueue({ name: QUEUE_NAMES.RAG_INGEST }),

    // Multer for multipart file uploads
    MulterModule.register({ limits: { fileSize: 50 * 1024 * 1024 } }),

    // RagModule provides EmbeddingService and RetrievalService
    RagModule,
  ],
  controllers: [KnowledgeController],
  providers: [
    DocumentService,
    ChunkingService,
    IngestionService,
    RagIngestWorker,
  ],
  exports: [DocumentService, ChunkingService, IngestionService],
})
export class KnowledgeModule {}
