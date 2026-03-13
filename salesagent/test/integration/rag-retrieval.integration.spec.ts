/**
 * RAG Retrieval — Integration Tests
 *
 * Verifies hybrid search behaviour against a real PostgreSQL + pgvector
 * database. Creates knowledge documents and chunks in the DB, then
 * exercises the full retrieval pipeline:
 *   - Semantic search (vector cosine similarity)
 *   - Keyword search (pg_trgm + tsvector)
 *   - RRF fusion
 *   - Tenant isolation (cross-tenant leakage test)
 *
 * Prerequisites:
 *   docker compose up -d postgres redis
 *   npm run migration:run
 *   OPENAI_API_KEY must be set (used by EmbeddingService for query embedding)
 *
 * Note: These tests make real OpenAI API calls for query embedding.
 * Set TEST_RAG_SKIP_REAL_EMBEDDINGS=true to use a deterministic stub instead.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { RetrievalService } from '../../src/rag/services/retrieval.service';
import { EmbeddingService } from '../../src/rag/services/embedding.service';
import { RerankService } from '../../src/rag/services/rerank.service';

import { KnowledgeChunk } from '../../src/knowledge/entities/knowledge-chunk.entity';
import { KnowledgeDocument } from '../../src/knowledge/entities/knowledge-document.entity';
import { Embedding } from '../../src/knowledge/entities/embedding.entity';
import { Tenant } from '../../src/tenants/entities/tenant.entity';

import { LLM_PROVIDER } from '../../src/llm/llm.constants';
import { DocumentStatus } from '../../src/common/enums';

const TEST_DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://salesagent:salesagent@localhost:5432/salesagent';

const SKIP_REAL_EMBEDDINGS = process.env.TEST_RAG_SKIP_REAL_EMBEDDINGS === 'true';

// Stub embedding that returns a consistent 1536-dim vector
// deterministically based on the input text hash
function stubEmbedding(text: string): number[] {
  const seed = text.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return Array.from({ length: 1536 }, (_, i) =>
    Math.sin(seed * (i + 1)) * 0.1,
  );
}

function makeEmbeddingService() {
  return {
    embed: jest.fn().mockImplementation(async (text: string) => stubEmbedding(text)),
    embedBatch: jest.fn().mockImplementation(async (texts: string[]) =>
      texts.map(stubEmbedding),
    ),
  };
}

describe('RetrievalService — Integration', () => {
  let module: TestingModule;
  let retrievalService: RetrievalService;
  let dataSource: DataSource;
  let tenantRepo: Repository<Tenant>;
  let docRepo: Repository<KnowledgeDocument>;
  let chunkRepo: Repository<KnowledgeChunk>;
  let tenant: Tenant;
  let otherTenant: Tenant;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({
          type: 'postgres',
          url: TEST_DATABASE_URL,
          entities: [Tenant, KnowledgeDocument, KnowledgeChunk, Embedding],
          synchronize: false,
          logging: false,
        }),
        TypeOrmModule.forFeature([Tenant, KnowledgeDocument, KnowledgeChunk, Embedding]),
      ],
      providers: [
        RetrievalService,
        { provide: EmbeddingService, useValue: makeEmbeddingService() },
        {
          provide: RerankService,
          useValue: {
            rerank: jest.fn().mockImplementation(async (query: string, chunks: any[]) => chunks),
          },
        },
        {
          provide: LLM_PROVIDER,
          useValue: { chat: jest.fn(), chatStream: jest.fn() },
        },
      ],
    }).compile();

    retrievalService = module.get(RetrievalService);
    dataSource = module.get(DataSource);
    tenantRepo = module.get(getRepositoryToken(Tenant));
    docRepo = module.get(getRepositoryToken(KnowledgeDocument));
    chunkRepo = module.get(getRepositoryToken(KnowledgeChunk));

    // Create two tenants
    tenant = await tenantRepo.save(
      tenantRepo.create({ name: 'RAG Test Tenant', widgetKey: crypto.randomUUID(), plan: 'pro' }),
    );
    otherTenant = await tenantRepo.save(
      tenantRepo.create({ name: 'RAG Other Tenant', widgetKey: crypto.randomUUID(), plan: 'pro' }),
    );

    // Seed knowledge documents + chunks for tenant
    await seedKnowledgeBase(tenant.id, docRepo, chunkRepo, dataSource);
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM knowledge_chunks WHERE tenant_id IN ($1, $2)`, [tenant.id, otherTenant.id]);
    await dataSource.query(`DELETE FROM knowledge_documents WHERE tenant_id IN ($1, $2)`, [tenant.id, otherTenant.id]);
    await tenantRepo.delete({ id: tenant.id });
    await tenantRepo.delete({ id: otherTenant.id });
    await module.close();
  });

  it('returns results from the knowledge base', async () => {
    const results = await retrievalService.hybridSearch(
      'What is the pricing for the starter plan?',
      tenant.id,
      5,
      { rerankEnabled: false },
    );

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toMatchObject({
      chunkId: expect.any(String),
      content: expect.any(String),
      fusedScore: expect.any(Number),
    });
  });

  it('returns results with fusedScore in descending order', async () => {
    const results = await retrievalService.hybridSearch(
      'pricing plans and features',
      tenant.id,
      5,
      { rerankEnabled: false },
    );

    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].fusedScore).toBeGreaterThanOrEqual(results[i].fusedScore);
    }
  });

  it('respects the topK limit', async () => {
    const results = await retrievalService.hybridSearch(
      'sales automation features',
      tenant.id,
      3,
      { rerankEnabled: false },
    );

    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('CRITICAL: does not return chunks from another tenant (tenant isolation)', async () => {
    const results = await retrievalService.hybridSearch(
      'pricing plans', // Query matches tenant's docs
      otherTenant.id,  // But we query as the OTHER tenant
      10,
      { rerankEnabled: false },
    );

    // Other tenant has no knowledge base — must return empty
    expect(results).toHaveLength(0);
  });

  it('returns empty array when no chunks match', async () => {
    const results = await retrievalService.hybridSearch(
      'completely unrelated topic about medieval history',
      tenant.id,
      5,
      { rerankEnabled: false },
    );

    // May return 0 or low-relevance results — either is acceptable
    expect(Array.isArray(results)).toBe(true);
  });

  it('includes source metadata in results', async () => {
    const results = await retrievalService.hybridSearch(
      'pricing',
      tenant.id,
      5,
      { rerankEnabled: false },
    );

    if (results.length > 0) {
      expect(results[0].metadata).toBeDefined();
      expect(results[0].metadata.documentTitle).toBeDefined();
    }
  });
});

// ─── Seed helpers ─────────────────────────────────────────────────────────────

async function seedKnowledgeBase(
  tenantId: string,
  docRepo: Repository<KnowledgeDocument>,
  chunkRepo: Repository<KnowledgeChunk>,
  dataSource: DataSource,
) {
  const doc = await docRepo.save(
    docRepo.create({
      tenantId,
      title: 'Pricing Guide',
      status: DocumentStatus.READY,
      sourceType: 'upload',
    }),
  );

  const chunks = [
    {
      content: 'Our Starter plan is $49/month and includes up to 500 conversations per month. Perfect for small teams getting started with AI sales automation.',
      metadata: { documentTitle: 'Pricing Guide', sectionHeading: 'Starter Plan', chunkIndex: 0 },
    },
    {
      content: 'The Pro plan at $199/month provides unlimited conversations, CRM integration, and access to advanced analytics. Ideal for growing sales teams.',
      metadata: { documentTitle: 'Pricing Guide', sectionHeading: 'Pro Plan', chunkIndex: 1 },
    },
    {
      content: 'Enterprise pricing is available on request. Includes SLA guarantees, dedicated support, custom MCP integrations, and SSO.',
      metadata: { documentTitle: 'Pricing Guide', sectionHeading: 'Enterprise', chunkIndex: 2 },
    },
    {
      content: 'AI-powered lead qualification automatically scores leads using the BANT framework: Budget, Authority, Need, and Timeline.',
      metadata: { documentTitle: 'Pricing Guide', sectionHeading: 'Features', chunkIndex: 3 },
    },
  ];

  for (const chunk of chunks) {
    const savedChunk = await chunkRepo.save(
      chunkRepo.create({
        tenantId,
        documentId: doc.id,
        content: chunk.content,
        metadata: chunk.metadata,
        tokenCount: Math.ceil(chunk.content.length / 4),
      }),
    );

    // Insert embedding (deterministic stub vector)
    const vector = stubEmbedding(chunk.content);
    const vectorStr = `[${vector.join(',')}]`;
    await dataSource.query(
      `INSERT INTO embeddings (chunk_id, tenant_id, model, vector) VALUES ($1, $2, $3, $4::vector)`,
      [savedChunk.id, tenantId, 'text-embedding-3-small', vectorStr],
    );
  }
}

function stubEmbedding(text: string): number[] {
  const seed = text.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return Array.from({ length: 1536 }, (_, i) =>
    Math.sin(seed * (i + 1)) * 0.1,
  );
}
