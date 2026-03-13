import {
  Entity,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
  OneToOne,
} from 'typeorm';
import { TenantScopedEntity } from '../../common/entities/tenant-scoped.entity';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { KnowledgeDocument } from './knowledge-document.entity';
import { Embedding } from './embedding.entity';

export interface ChunkMetadata {
  chunkIndex: number;         // position within document (0-based)
  pageNumber?: number;
  sectionHeading?: string;
  startChar?: number;         // character offset in original document
  endChar?: number;
}

/**
 * KnowledgeChunk is one text segment from a KnowledgeDocument.
 * Created by ChunkingService (512 tokens, 100-token overlap, recursive split).
 *
 * tenantId is denormalized from the parent document for query performance:
 * the RetrievalService filters by tenantId BEFORE the vector similarity
 * operation — this is mandatory for tenant isolation with pgvector.
 *
 * The actual embedding vector lives in the Embedding entity (1:1)
 * to keep this table lean and allow loading chunks without always
 * pulling the 6KB float array.
 */
@Entity('knowledge_chunks')
@Index(['tenantId'])                            // mandatory pre-filter for ANN search
@Index(['tenantId', 'documentId'])              // cascade delete lookup
@Index(['documentId'])
export class KnowledgeChunk extends TenantScopedEntity {
  @Column({ type: 'uuid', name: 'document_id', nullable: false })
  documentId: string;

  /** Raw text of this chunk. Used for keyword search and LLM context injection. */
  @Column({ type: 'text', nullable: false })
  content: string;

  /** Position and structural metadata within the source document. */
  @Column({ type: 'jsonb', nullable: false })
  metadata: ChunkMetadata;

  /**
   * Token count (cl100k_base). Stored to:
   * 1. Verify chunking strategy compliance (max 512 tokens)
   * 2. Allow MemoryManagerService to account for retrieved chunk tokens
   */
  @Column({ type: 'int', name: 'token_count', nullable: false })
  tokenCount: number;

  /**
   * Full-text search vector, maintained by PostgreSQL trigger.
   * Populated by:
   *   CREATE INDEX ON knowledge_chunks USING gin(to_tsvector('english', content));
   * Do not set from application code.
   */

  // --- Relations ---------------------------------------------------------------
  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @ManyToOne(() => KnowledgeDocument, (doc) => doc.chunks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'document_id' })
  document: KnowledgeDocument;

  @OneToOne(() => Embedding, (emb) => emb.chunk, { cascade: ['insert', 'remove'] })
  embedding: Embedding;
}
