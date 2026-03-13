import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Repository } from 'typeorm';
import { Queue } from 'bullmq';
import { KnowledgeDocument, DocumentIngestionMeta } from '../entities/knowledge-document.entity';
import { KnowledgeChunk } from '../entities/knowledge-chunk.entity';
import { Embedding } from '../entities/embedding.entity';
import { DocumentStatus, DocumentSourceType } from '../../common/enums';
import { QUEUE_NAMES, RagIngestJob } from '../../common/types/queue-jobs.types';

export interface CreateDocumentFromUploadDto {
  tenantId: string;
  title: string;
  /** Raw file buffer. Stored in-process; real production code uses S3. */
  buffer: Buffer;
  mimeType: string;
  originalFileName: string;
  tags?: string[];
}

export interface CreateDocumentFromUrlDto {
  tenantId: string;
  title?: string;
  url: string;
  tags?: string[];
}

export interface CrawlSiteOptions {
  tenantId: string;
  url: string;
  maxPages: number;
  tags?: string[];
}

export interface CreateDocumentManualDto {
  tenantId: string;
  title: string;
  content: string; // raw text content
  tags?: string[];
}

export interface DocumentListFilters {
  status?: DocumentStatus;
  tags?: string[];
  sourceType?: DocumentSourceType;
}

const SUPPORTED_MIME_TYPES: Record<string, DocumentSourceType> = {
  'application/pdf': DocumentSourceType.UPLOAD,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': DocumentSourceType.UPLOAD,
  'text/plain': DocumentSourceType.UPLOAD,
  'text/markdown': DocumentSourceType.UPLOAD,
  'text/html': DocumentSourceType.UPLOAD,
};

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

/**
 * DocumentService — CRUD for KnowledgeDocument records.
 *
 * Owns:
 *  - Document creation (from upload, URL, or manual text)
 *  - Status lifecycle management (pending → processing → ready / failed)
 *  - Ingestion job enqueueing into the rag-ingest BullMQ queue
 *  - Cascade deletion (chunks + embeddings deleted by DB cascade)
 *  - Tag-based filtering for RAG scope control
 *
 * Note on storage: this service holds file buffers in-process and passes them
 * to IngestionService directly. A production deployment should use an object
 * store (S3 / GCS) — replace `buffer` fields with `storageKey` references.
 *
 * In-memory buffer map: documentId → Buffer. Cleared after ingestion completes.
 */
@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);

  /**
   * Temporary in-process buffer store.
   * In production: upload to S3, store key in KnowledgeDocument.storageKey,
   * and have IngestionService stream from S3.
   */
  readonly pendingBuffers = new Map<string, Buffer>();

  constructor(
    @InjectRepository(KnowledgeDocument)
    private readonly docRepo: Repository<KnowledgeDocument>,

    @InjectRepository(KnowledgeChunk)
    private readonly chunkRepo: Repository<KnowledgeChunk>,

    @InjectRepository(Embedding)
    private readonly embeddingRepo: Repository<Embedding>,

    @InjectQueue(QUEUE_NAMES.RAG_INGEST)
    private readonly ingestQueue: Queue<RagIngestJob>,
  ) {}

  // ─── Document creation ────────────────────────────────────────────────────

  async createFromUpload(dto: CreateDocumentFromUploadDto): Promise<KnowledgeDocument> {
    if (dto.buffer.length > MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException(`File exceeds 50MB limit`);
    }

    const mimeType = dto.mimeType.split(';')[0].trim().toLowerCase();
    if (!SUPPORTED_MIME_TYPES[mimeType]) {
      throw new BadRequestException(
        `Unsupported file type: ${mimeType}. ` +
        `Supported: PDF, DOCX, TXT, Markdown, HTML`,
      );
    }

    const doc = await this.docRepo.save(
      this.docRepo.create({
        tenantId: dto.tenantId,
        title: dto.title || dto.originalFileName,
        sourceType: DocumentSourceType.UPLOAD,
        sourceUrl: null,
        storageKey: null,
        status: DocumentStatus.PENDING,
        tags: dto.tags ?? [],
        ingestionMeta: {
          originalFileName: dto.originalFileName,
          mimeType,
          fileSizeBytes: dto.buffer.length,
        },
      }),
    );

    // Hold buffer in-memory until worker processes it
    this.pendingBuffers.set(doc.id, dto.buffer);

    // Enqueue ingestion job
    await this.enqueueIngest(doc.id, dto.tenantId);

    this.logger.log(
      `Document created from upload: id=${doc.id} title="${doc.title}" ` +
      `size=${dto.buffer.length}b tenant=${dto.tenantId}`,
    );

    return doc;
  }

  async createFromUrl(dto: CreateDocumentFromUrlDto): Promise<KnowledgeDocument> {
    const parsedUrl = new URL(dto.url); // validates URL format

    const doc = await this.docRepo.save(
      this.docRepo.create({
        tenantId: dto.tenantId,
        title: dto.title || parsedUrl.hostname + parsedUrl.pathname,
        sourceType: DocumentSourceType.URL,
        sourceUrl: dto.url,
        storageKey: null,
        status: DocumentStatus.PENDING,
        tags: dto.tags ?? [],
        ingestionMeta: null,
      }),
    );

    await this.enqueueIngest(doc.id, dto.tenantId);

    this.logger.log(`Document created from URL: id=${doc.id} url=${dto.url} tenant=${dto.tenantId}`);
    return doc;
  }

  /**
   * Crawl an entire website and index each page as a separate document.
   *
   * Strategy (in order):
   * 1. Try to fetch /sitemap.xml and extract all <loc> URLs
   * 2. If sitemap has < 3 URLs or fails, fall back to crawling links on the homepage
   * 3. Filter to same-domain URLs only, deduplicate, cap at maxPages
   * 4. Queue each URL as a separate rag-ingest job
   */
  async crawlSite(opts: CrawlSiteOptions): Promise<{ queued: number; urls: string[] }> {
    const base = new URL(opts.url);
    const urls = await this.discoverUrls(base, opts.maxPages);

    const queued: string[] = [];

    for (const url of urls) {
      try {
        const parsed = new URL(url);
        const doc = await this.docRepo.save(
          this.docRepo.create({
            tenantId: opts.tenantId,
            title: parsed.hostname + parsed.pathname,
            sourceType: DocumentSourceType.URL,
            sourceUrl: url,
            storageKey: null,
            status: DocumentStatus.PENDING,
            tags: opts.tags ?? [],
            ingestionMeta: null,
          }),
        );
        await this.enqueueIngest(doc.id, opts.tenantId);
        queued.push(url);
      } catch (err) {
        this.logger.warn(`Skipping URL during crawl: ${url} — ${err instanceof Error ? err.message : err}`);
      }
    }

    this.logger.log(`Site crawl queued: ${queued.length} pages from ${opts.url} tenant=${opts.tenantId}`);
    return { queued: queued.length, urls: queued };
  }

  private async discoverUrls(base: URL, maxPages: number): Promise<string[]> {
    const sitemapUrl = `${base.origin}/sitemap.xml`;
    let urls: string[] = [];

    // 1. Try sitemap
    try {
      const res = await fetch(sitemapUrl, {
        headers: { 'User-Agent': 'SalesAgent-Indexer/1.0' },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const xml = await res.text();
        const matches = [...xml.matchAll(/<loc>\s*(https?:\/\/[^\s<]+)\s*<\/loc>/gi)];
        urls = matches.map((m) => m[1].trim()).filter((u) => new URL(u).hostname === base.hostname);
        this.logger.log(`Sitemap found at ${sitemapUrl}: ${urls.length} URLs`);
      }
    } catch {
      this.logger.debug(`No sitemap at ${sitemapUrl}, falling back to link crawl`);
    }

    // 2. Fallback: crawl links on the homepage
    if (urls.length < 3) {
      try {
        const res = await fetch(base.href, {
          headers: { 'User-Agent': 'SalesAgent-Indexer/1.0' },
          signal: AbortSignal.timeout(15_000),
        });
        if (res.ok) {
          const html = await res.text();
          const { load } = await import('cheerio');
          const $ = load(html);
          const found = new Set<string>([base.href]);
          $('a[href]').each((_, el) => {
            const href = $(el).attr('href');
            if (!href) return;
            try {
              const abs = new URL(href, base.origin).href;
              if (new URL(abs).hostname === base.hostname && !abs.includes('#')) {
                found.add(abs);
              }
            } catch { /* ignore malformed */ }
          });
          urls = [...found];
          this.logger.log(`Link crawl on ${base.href}: found ${urls.length} URLs`);
        }
      } catch (err) {
        this.logger.warn(`Homepage crawl failed: ${err instanceof Error ? err.message : err}`);
        // Fall back to just the root URL
        urls = [base.href];
      }
    }

    // Always include the root URL
    if (!urls.includes(base.href)) urls.unshift(base.href);

    // Filter out common non-content paths
    const skip = /\.(png|jpg|jpeg|gif|svg|ico|css|js|woff|ttf|pdf|zip)\b/i;
    urls = urls.filter((u) => !skip.test(new URL(u).pathname));

    return [...new Set(urls)].slice(0, maxPages);
  }

  async createFromText(dto: CreateDocumentManualDto): Promise<KnowledgeDocument> {
    const doc = await this.docRepo.save(
      this.docRepo.create({
        tenantId: dto.tenantId,
        title: dto.title,
        sourceType: DocumentSourceType.MANUAL,
        sourceUrl: null,
        storageKey: null,
        status: DocumentStatus.PENDING,
        tags: dto.tags ?? [],
        ingestionMeta: {
          mimeType: 'text/plain',
          fileSizeBytes: Buffer.byteLength(dto.content, 'utf8'),
          charsExtracted: dto.content.length,
        },
      }),
    );

    // Manual text: store as buffer so IngestionService can process it uniformly
    this.pendingBuffers.set(doc.id, Buffer.from(dto.content, 'utf8'));

    await this.enqueueIngest(doc.id, dto.tenantId);

    this.logger.log(`Document created from text: id=${doc.id} title="${doc.title}" tenant=${dto.tenantId}`);
    return doc;
  }

  // ─── Read operations ──────────────────────────────────────────────────────

  async findAll(
    tenantId: string,
    filters: DocumentListFilters = {},
    pagination = { page: 1, limit: 20 },
  ): Promise<[KnowledgeDocument[], number]> {
    const qb = this.docRepo
      .createQueryBuilder('doc')
      .where('doc.tenant_id = :tenantId', { tenantId })
      .orderBy('doc.created_at', 'DESC')
      .skip((pagination.page - 1) * pagination.limit)
      .take(pagination.limit);

    if (filters.status) {
      qb.andWhere('doc.status = :status', { status: filters.status });
    }
    if (filters.sourceType) {
      qb.andWhere('doc.source_type = :sourceType', { sourceType: filters.sourceType });
    }
    if (filters.tags && filters.tags.length > 0) {
      qb.andWhere('doc.tags && :tags', { tags: filters.tags }); // array overlap
    }

    return qb.getManyAndCount();
  }

  async findById(id: string, tenantId: string): Promise<KnowledgeDocument> {
    const doc = await this.docRepo.findOne({ where: { id, tenantId } });
    if (!doc) throw new NotFoundException(`Document ${id} not found`);
    return doc;
  }

  // ─── Status management ────────────────────────────────────────────────────

  async markProcessing(id: string): Promise<void> {
    await this.docRepo.update(id, { status: DocumentStatus.PROCESSING });
  }

  async markReady(id: string, chunkCount: number, meta: Partial<DocumentIngestionMeta>): Promise<void> {
    await this.docRepo.update(id, {
      status: DocumentStatus.READY,
      chunkCount,
      ingestedAt: new Date(),
      errorMessage: null,
      ingestionMeta: () => `ingestion_meta || '${JSON.stringify(meta)}'::jsonb`,
    });
  }

  async markFailed(id: string, errorMessage: string): Promise<void> {
    await this.docRepo.update(id, {
      status: DocumentStatus.FAILED,
      errorMessage: errorMessage.slice(0, 1000),
    });
  }

  // ─── Deletion ─────────────────────────────────────────────────────────────

  /**
   * Delete a document and all associated chunks + embeddings.
   * DB cascade handles KnowledgeChunk and Embedding deletion.
   */
  async delete(id: string, tenantId: string): Promise<void> {
    const doc = await this.findById(id, tenantId);
    await this.docRepo.remove(doc);
    this.pendingBuffers.delete(id);
    this.logger.log(`Document deleted: id=${id} tenant=${tenantId}`);
  }

  /**
   * Re-ingest a document (e.g. after editing tags or if ingestion failed).
   * Deletes existing chunks, resets status to pending, re-enqueues.
   */
  async reIngest(id: string, tenantId: string): Promise<void> {
    await this.findById(id, tenantId);

    // Delete existing chunks (embeddings cascade)
    await this.chunkRepo
      .createQueryBuilder()
      .delete()
      .where('document_id = :id', { id })
      .andWhere('tenant_id = :tenantId', { tenantId })
      .execute();

    await this.docRepo.update(id, {
      status: DocumentStatus.PENDING,
      chunkCount: 0,
      errorMessage: null,
      ingestedAt: null,
    });

    await this.enqueueIngest(id, tenantId);
    this.logger.log(`Document re-ingestion queued: id=${id}`);
  }

  // ─── Queue helpers ────────────────────────────────────────────────────────

  private async enqueueIngest(documentId: string, tenantId: string): Promise<void> {
    await this.ingestQueue.add(
      'rag-ingest',
      { tenantId, documentId },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    );
    this.logger.debug(`Ingestion job enqueued: documentId=${documentId}`);
  }
}
