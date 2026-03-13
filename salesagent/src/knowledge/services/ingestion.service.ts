import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { KnowledgeDocument } from '../entities/knowledge-document.entity';
import { KnowledgeChunk } from '../entities/knowledge-chunk.entity';
import { Embedding } from '../entities/embedding.entity';
import { DocumentService } from './document.service';
import { ChunkingService, ChunkDraft, ChunkSourceMetadata } from './chunking.service';
import { EmbeddingService } from '../../rag/services/embedding.service';
import { DocumentStatus, DocumentSourceType } from '../../common/enums';

/**
 * IngestionService — orchestrates the full document ingestion pipeline.
 *
 * Pipeline steps:
 *  1. Load KnowledgeDocument record
 *  2. Parse raw content:
 *       PDF   → pdf-parse (per-page text extraction)
 *       DOCX  → mammoth (flat HTML → text)
 *       HTML  → cheerio (DOM → clean text)
 *       TXT / Markdown → plain text
 *       URL   → fetch + cheerio
 *  3. ChunkingService.chunk() → ChunkDraft[]
 *  4. EmbeddingService.embedBatch() → number[][]
 *  5. Bulk-insert KnowledgeChunk + Embedding records in a transaction
 *  6. DocumentService.markReady()
 *
 * Error handling:
 *  - Parse errors: permanent failure (don't retry) → markFailed()
 *  - Embedding API errors: propagate to BullMQ worker (retried with backoff)
 *  - DB errors: propagate (retried by BullMQ)
 *
 * Performance:
 *  - Embeddings: batched in groups of 100 (OpenAI limit)
 *  - DB inserts: single bulk INSERT per chunk/embedding batch
 *  - Transaction: wraps both chunk and embedding inserts
 */
@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    @InjectRepository(KnowledgeDocument)
    private readonly docRepo: Repository<KnowledgeDocument>,

    @InjectRepository(KnowledgeChunk)
    private readonly chunkRepo: Repository<KnowledgeChunk>,

    @InjectRepository(Embedding)
    private readonly embeddingRepo: Repository<Embedding>,

    private readonly documentService: DocumentService,
    private readonly chunking: ChunkingService,
    private readonly embedding: EmbeddingService,
    private readonly dataSource: DataSource,
  ) {}

  // ─── Main pipeline ────────────────────────────────────────────────────────

  async ingest(documentId: string, tenantId: string): Promise<void> {
    await this.documentService.markProcessing(documentId);

    const doc = await this.docRepo.findOneOrFail({ where: { id: documentId, tenantId } });

    this.logger.log(
      `Ingestion start: id=${documentId} title="${doc.title}" source=${doc.sourceType}`,
    );

    try {
      // 1. Parse → structured text
      const { pages, fullText, ingestionMeta } = await this.parseDocument(doc);

      // 2. Chunk
      const chunkSourceMeta: ChunkSourceMetadata = {
        documentId: doc.id,
        tenantId: doc.tenantId,
        documentTitle: doc.title,
        sourceUrl: doc.sourceUrl ?? undefined,
      };

      let drafts: ChunkDraft[];
      if (pages.length > 0) {
        drafts = this.chunking.chunkByPages(pages, chunkSourceMeta);
      } else {
        drafts = this.chunking.chunk(fullText, chunkSourceMeta);
      }

      if (drafts.length === 0) {
        throw new PermanentIngestionError('Document parsed to empty text — nothing to ingest');
      }

      // 3. Embed all chunks
      const vectors = await this.embedding.embedBatch(drafts.map((d) => d.content));

      if (vectors.length !== drafts.length) {
        throw new Error(
          `Embedding count mismatch: expected ${drafts.length}, got ${vectors.length}`,
        );
      }

      // 4. Bulk insert chunks + embeddings in a transaction
      await this.dataSource.transaction(async (manager) => {
        // Build chunk entities
        const chunkEntities = drafts.map((draft) =>
          this.chunkRepo.create({
            tenantId: doc.tenantId,
            documentId: doc.id,
            content: draft.content,
            tokenCount: draft.tokenCount,
            metadata: draft.metadata,
          }),
        );

        // Bulk insert chunks — TypeORM generates a single multi-row INSERT
        const savedChunks = await manager.save(KnowledgeChunk, chunkEntities);

        // Build embedding entities (requires chunk IDs from saved chunks)
        const embeddingEntities = savedChunks.map((chunk, i) =>
          this.embeddingRepo.create({
            chunkId: chunk.id,
            tenantId: doc.tenantId,
            model: this.embedding.modelName,
            dimensions: this.embedding.dimensions,
            vector: vectors[i],
          }),
        );

        await manager.save(Embedding, embeddingEntities);
      });

      // 5. Mark document ready
      await this.documentService.markReady(documentId, drafts.length, {
        ...ingestionMeta,
        charsExtracted: fullText.length,
      });

      // Clean up in-memory buffer
      this.documentService.pendingBuffers.delete(documentId);

      this.logger.log(
        `Ingestion complete: id=${documentId} chunks=${drafts.length} ` +
        `model=${this.embedding.modelName}`,
      );
    } catch (err: unknown) {
      const isPermanent = err instanceof PermanentIngestionError;
      const message = err instanceof Error ? err.message : String(err);

      this.logger.error(`Ingestion failed: id=${documentId} permanent=${isPermanent} ${message}`);
      await this.documentService.markFailed(documentId, message);

      // Re-throw non-permanent errors so BullMQ retries them (e.g. embedding API timeout)
      if (!isPermanent) throw err;
    }
  }

  // ─── Document parsers ─────────────────────────────────────────────────────

  private async parseDocument(doc: KnowledgeDocument): Promise<{
    fullText: string;
    pages: Array<{ text: string; pageNumber: number }>;
    ingestionMeta: Record<string, unknown>;
  }> {
    const buffer = this.documentService.pendingBuffers.get(doc.id);
    const mimeType = doc.ingestionMeta?.mimeType ?? 'text/plain';

    try {
      if (doc.sourceType === DocumentSourceType.URL) {
        return this.parseUrl(doc.sourceUrl!);
      }

      if (!buffer) {
        // Buffer was cleared — re-parsing an already-processed document should not happen
        throw new PermanentIngestionError(`No buffer available for document ${doc.id}`);
      }

      if (mimeType === 'application/pdf') {
        return this.parsePdf(buffer);
      }

      if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        return this.parseDocx(buffer);
      }

      if (mimeType === 'text/html') {
        return this.parseHtml(buffer.toString('utf8'), doc.sourceUrl ?? undefined);
      }

      // Plain text, Markdown, manual
      const text = buffer.toString('utf8');
      return { fullText: text, pages: [], ingestionMeta: { parserUsed: 'plaintext' } };
    } catch (err: unknown) {
      if (err instanceof PermanentIngestionError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new PermanentIngestionError(`Failed to parse ${mimeType}: ${msg}`);
    }
  }

  // ─── PDF parser ───────────────────────────────────────────────────────────

  private async parsePdf(buffer: Buffer): Promise<{
    fullText: string;
    pages: Array<{ text: string; pageNumber: number }>;
    ingestionMeta: Record<string, unknown>;
  }> {
    // Dynamic import — pdf-parse is an optional peer dependency
    const pdfParse = await import('pdf-parse').then((m) => m.default ?? m);

    interface PdfData {
      text: string;
      numpages: number;
      info?: Record<string, unknown>;
    }

    // pdf-parse renders all pages into a single text blob.
    // For per-page splitting, we use a custom page renderer.
    const pages: Array<{ text: string; pageNumber: number }> = [];
    let currentPage = 1;

    const data: PdfData = await pdfParse(buffer, {
      pagerender: (pageData: { getTextContent: () => Promise<{ items: Array<{ str: string }> }> }) => {
        return pageData.getTextContent().then((textContent) => {
          const pageText = textContent.items.map((item) => item.str).join(' ');
          pages.push({ text: pageText.trim(), pageNumber: currentPage });
          currentPage++;
          return pageText;
        });
      },
    });

    return {
      fullText: data.text,
      pages: pages.filter((p) => p.text.length > 0),
      ingestionMeta: {
        parserUsed: 'pdf-parse',
        pageCount: data.numpages,
        charsExtracted: data.text.length,
      },
    };
  }

  // ─── DOCX parser ──────────────────────────────────────────────────────────

  private async parseDocx(buffer: Buffer): Promise<{
    fullText: string;
    pages: Array<{ text: string; pageNumber: number }>;
    ingestionMeta: Record<string, unknown>;
  }> {
    const mammoth = await import('mammoth');

    const result = await mammoth.extractRawText({ buffer });
    const text = result.value.trim();

    return {
      fullText: text,
      pages: [], // DOCX has no reliable page boundaries in text form
      ingestionMeta: {
        parserUsed: 'mammoth',
        charsExtracted: text.length,
      },
    };
  }

  // ─── HTML parser ──────────────────────────────────────────────────────────

  private async parseHtml(html: string, sourceUrl?: string): Promise<{
    fullText: string;
    pages: Array<{ text: string; pageNumber: number }>;
    ingestionMeta: Record<string, unknown>;
  }> {
    const { load } = await import('cheerio');
    const $ = load(html);

    // Remove non-content elements
    $('script, style, nav, header, footer, aside, .cookie-banner, [role="banner"]').remove();

    // Extract visible text with semantic structure preserved
    const text = $('body')
      .find('h1, h2, h3, h4, h5, h6, p, li, td, th, blockquote, pre')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((t) => t.length > 0)
      .join('\n\n');

    const cleanText = text.replace(/\n{3,}/g, '\n\n').trim();

    return {
      fullText: cleanText,
      pages: [],
      ingestionMeta: {
        parserUsed: 'cheerio',
        sourceUrl,
        charsExtracted: cleanText.length,
      },
    };
  }

  // ─── URL fetcher ──────────────────────────────────────────────────────────

  private async parseUrl(url: string): Promise<{
    fullText: string;
    pages: Array<{ text: string; pageNumber: number }>;
    ingestionMeta: Record<string, unknown>;
  }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);

    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'SalesAgent-Indexer/1.0' },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new PermanentIngestionError(`URL fetch failed: HTTP ${response.status}`);
      }

      const contentType = response.headers.get('content-type') ?? '';
      const html = await response.text();

      if (contentType.includes('application/pdf')) {
        const buffer = Buffer.from(await response.arrayBuffer());
        return this.parsePdf(buffer);
      }

      return this.parseHtml(html, url);
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof PermanentIngestionError) throw err;
      const msg = err instanceof Error && err.name === 'AbortError'
        ? 'URL fetch timed out (30s)'
        : err instanceof Error ? err.message : String(err);
      throw new PermanentIngestionError(`URL fetch error: ${msg}`);
    }
  }
}

/**
 * Signals that the ingestion failed in a way that cannot be fixed by retrying
 * (parse error, malformed file, empty document). BullMQ workers catch this
 * and do not schedule a retry.
 */
export class PermanentIngestionError extends Error {
  readonly isPermanent = true;

  constructor(message: string) {
    super(message);
    this.name = 'PermanentIngestionError';
  }
}
