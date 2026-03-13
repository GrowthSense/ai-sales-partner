import {
  Entity,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';
import { KnowledgeChunk } from './knowledge-chunk.entity';

/**
 * Embedding stores the vector representation of one KnowledgeChunk.
 * Separated from KnowledgeChunk to:
 *   1. Keep the chunks table lean (no 6KB float array on every row scan)
 *   2. Allow future support for multiple embedding models per chunk
 *   3. Isolate the HNSW index to a dedicated table
 *
 * pgvector column notes:
 *   - DB column type MUST be vector(1536) — set via migration, not TypeORM sync
 *   - TypeORM reads/writes as number[] via the transformer below
 *   - HNSW index is created in migration (not declaratively in TypeORM)
 *
 * Migration DDL:
 *   ALTER TABLE embeddings ALTER COLUMN vector TYPE vector(1536)
 *     USING vector::vector(1536);
 *   CREATE INDEX idx_embeddings_hnsw ON embeddings
 *     USING hnsw (vector vector_cosine_ops) WITH (m=16, ef_construction=64);
 *
 * Query pattern (ALWAYS include tenant_id pre-filter):
 *   SELECT ec.*, e.vector <=> $1::vector AS distance
 *   FROM embeddings e
 *   JOIN knowledge_chunks ec ON ec.id = e.chunk_id
 *   WHERE ec.tenant_id = $2
 *   ORDER BY distance LIMIT 20;
 */
@Entity('embeddings')
@Index(['chunkId'], { unique: true })
@Index(['tenantId'])      // denormalized for pre-filter without join
@Index(['model'])         // support for future multi-model embeddings
export class Embedding {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'chunk_id', unique: true, nullable: false })
  chunkId: string;

  /**
   * Denormalized tenantId for efficient pre-filtering before ANN search.
   * Avoids a JOIN on knowledge_chunks just to get the tenantId.
   */
  @Column({ type: 'uuid', name: 'tenant_id', nullable: false })
  @Index()
  tenantId: string;

  /**
   * Embedding model identifier.
   * e.g. 'text-embedding-3-small', 'text-embedding-3-large'
   * Stored to support re-embedding with a new model without losing old vectors.
   */
  @Column({ type: 'varchar', length: 100, nullable: false, default: 'text-embedding-3-small' })
  model: string;

  /** Embedding vector dimensions (1536 for text-embedding-3-small). */
  @Column({ type: 'smallint', nullable: false, default: 1536 })
  dimensions: number;

  /**
   * The embedding vector stored as a PostgreSQL vector(1536) column.
   *
   * TypeORM does not natively support pgvector's 'vector' type.
   * The column is declared as 'text' here; the migration alters it to
   * vector(1536) after TypeORM creates the table. The transformer handles
   * serialization/deserialization between number[] and pgvector text format.
   *
   * Transformer:
   *   to DB:   [0.123, -0.456, ...]  →  '[0.123,-0.456,...]'
   *   from DB: '[0.123,-0.456,...]'  →  [0.123, -0.456, ...]
   */
  @Column({
    type: 'text',
    name: 'vector',
    nullable: false,
    transformer: {
      to: (value: number[]): string => `[${value.join(',')}]`,
      from: (value: string): number[] =>
        value.replace(/[\[\]\s]/g, '').split(',').map(Number),
    },
  })
  vector: number[];

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  // --- Relations ---------------------------------------------------------------
  @OneToOne(() => KnowledgeChunk, (chunk) => chunk.embedding, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'chunk_id' })
  chunk: KnowledgeChunk;
}
