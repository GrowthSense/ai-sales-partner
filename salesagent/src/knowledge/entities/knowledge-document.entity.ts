import {
  Entity,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { TenantScopedEntity } from '../../common/entities/tenant-scoped.entity';
import { DocumentStatus, DocumentSourceType } from '../../common/enums';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { KnowledgeChunk } from './knowledge-chunk.entity';

export interface DocumentIngestionMeta {
  originalFileName?: string;
  mimeType?: string;
  fileSizeBytes?: number;
  pageCount?: number;
  parserUsed?: string;    // 'pdf-parse' | 'mammoth' | 'cheerio'
  charsExtracted?: number;
}

/**
 * KnowledgeDocument is an uploaded or synced document that forms the
 * tenant's knowledge base. Once ingested, its text is chunked, embedded,
 * and stored as KnowledgeChunk records with pgvector embeddings.
 */
@Entity('knowledge_documents')
@Index(['tenantId', 'status'])
@Index(['tenantId', 'sourceType'])
@Index(['tenantId', 'createdAt'])
export class KnowledgeDocument extends TenantScopedEntity {
  @Column({ type: 'varchar', length: 512, nullable: false })
  title: string;

  @Column({
    type: 'enum',
    enum: DocumentSourceType,
    name: 'source_type',
    nullable: false,
  })
  sourceType: DocumentSourceType;

  /** Original URL (for URL and sync sources). Null for file uploads. */
  @Column({ type: 'varchar', length: 2048, name: 'source_url', nullable: true })
  sourceUrl: string | null;

  /** S3 / object storage key for uploaded files. */
  @Column({ type: 'varchar', length: 1024, name: 'storage_key', nullable: true })
  storageKey: string | null;

  @Column({
    type: 'enum',
    enum: DocumentStatus,
    default: DocumentStatus.PENDING,
    nullable: false,
  })
  status: DocumentStatus;

  /** Human-readable error if status = FAILED. */
  @Column({ type: 'text', name: 'error_message', nullable: true })
  errorMessage: string | null;

  /** Number of KnowledgeChunk records created from this document. */
  @Column({ type: 'int', name: 'chunk_count', default: 0, nullable: false })
  chunkCount: number;

  /** Technical metadata captured during ingestion. */
  @Column({ type: 'jsonb', name: 'ingestion_meta', nullable: true })
  ingestionMeta: DocumentIngestionMeta | null;

  /**
   * Arbitrary tags for document categorisation.
   * Used to scope RAG retrieval (e.g. AnswerQuestion only searches 'faq' tag).
   */
  @Column({ type: 'text', array: true, nullable: false, default: '{}' })
  tags: string[];

  @Column({ type: 'timestamptz', name: 'ingested_at', nullable: true })
  ingestedAt: Date | null;

  // --- Relations ---------------------------------------------------------------
  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @OneToMany(() => KnowledgeChunk, (chunk) => chunk.document)
  chunks: KnowledgeChunk[];
}
