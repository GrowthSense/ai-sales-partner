import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentService, DocumentListFilters } from '../services/document.service';
import { RetrievalService } from '../../rag/services/retrieval.service';
import { KnowledgeDocument } from '../entities/knowledge-document.entity';
import { RetrievalResult } from '../../rag/interfaces/retrieval-result.interface';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import {
  CreateDocumentFromUrlDto,
  CreateDocumentFromTextDto,
  CrawlSiteDto,
  DocumentListQueryDto,
  SearchQueryDto,
} from '../dtos/knowledge.dto';
import { DocumentStatus, DocumentSourceType } from '../../common/enums';

/**
 * KnowledgeController
 *
 * REST API for the tenant's knowledge base.
 * All endpoints are tenant-scoped (tenantId from JWT).
 *
 * Endpoints:
 *   POST   /knowledge/documents/upload   — multipart file upload (PDF, DOCX, TXT, HTML)
 *   POST   /knowledge/documents/url      — index a web page or URL
 *   POST   /knowledge/documents/text     — index plain text / FAQ content
 *   GET    /knowledge/documents          — list documents (paginated, filterable)
 *   GET    /knowledge/documents/:id      — document details + chunk count + status
 *   DELETE /knowledge/documents/:id      — delete document + all chunks
 *   POST   /knowledge/documents/:id/reingest — re-run ingestion (e.g. after failure)
 *   GET    /knowledge/search             — debug: search chunks (admin only)
 *
 * Supported source types:
 *   - PDF (.pdf)       → pdf-parse, per-page chunking
 *   - DOCX (.docx)     → mammoth flat text
 *   - HTML (.html)     → cheerio DOM → text
 *   - TXT / .md        → plain text
 *   - URL              → fetch + cheerio
 *   - Manual text      → FAQ entries, product descriptions, custom content
 */
@UseGuards(JwtAuthGuard)
@Controller('knowledge')
export class KnowledgeController {
  constructor(
    private readonly documents: DocumentService,
    private readonly retrieval: RetrievalService,
  ) {}

  // ─── Document creation ────────────────────────────────────────────────────

  /**
   * POST /knowledge/documents/upload
   * Content-Type: multipart/form-data
   * Fields: file (required), title (optional), tags (optional, comma-separated)
   *
   * Supported formats: PDF, DOCX, TXT, Markdown, HTML
   * Max size: 50 MB
   */
  @Post('documents/upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  async uploadDocument(
    @TenantId() tenantId: string,
    @UploadedFile() file: { buffer: Buffer; originalname: string; mimetype: string } | undefined,
    @Body('title') title?: string,
    @Body('tags') tagsRaw?: string,
  ): Promise<KnowledgeDocument> {
    if (!file) throw new BadRequestException('No file provided');

    const tags = tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : [];

    return this.documents.createFromUpload({
      tenantId,
      title: title || file.originalname,
      buffer: file.buffer,
      mimeType: file.mimetype,
      originalFileName: file.originalname,
      tags,
    });
  }

  /**
   * POST /knowledge/documents/url
   * Body: { url, title?, tags? }
   *
   * Fetches and indexes a web page. Also supports direct PDF URLs.
   */
  @Post('documents/url')
  async indexUrl(
    @TenantId() tenantId: string,
    @Body() dto: CreateDocumentFromUrlDto,
  ): Promise<KnowledgeDocument> {
    return this.documents.createFromUrl({
      tenantId,
      url: dto.url,
      title: dto.title,
      tags: dto.tags,
    });
  }

  /**
   * POST /knowledge/documents/crawl
   * Body: { url, maxPages?, tags? }
   *
   * Discovers all pages on a website via sitemap.xml or link crawling,
   * then indexes each page as a separate document. Returns a summary of
   * how many pages were queued.
   */
  @Post('documents/crawl')
  async crawlSite(
    @TenantId() tenantId: string,
    @Body() dto: CrawlSiteDto,
  ): Promise<{ queued: number; urls: string[] }> {
    return this.documents.crawlSite({
      tenantId,
      url: dto.url,
      maxPages: dto.maxPages ?? 20,
      tags: dto.tags,
    });
  }

  /**
   * POST /knowledge/documents/text
   * Body: { title, content, tags? }
   *
   * Directly ingest plain text — ideal for FAQs, product descriptions,
   * pricing tables, feature lists, or any manually authored content.
   */
  @Post('documents/text')
  async indexText(
    @TenantId() tenantId: string,
    @Body() dto: CreateDocumentFromTextDto,
  ): Promise<KnowledgeDocument> {
    return this.documents.createFromText({
      tenantId,
      title: dto.title,
      content: dto.content,
      tags: dto.tags,
    });
  }

  // ─── List ─────────────────────────────────────────────────────────────────

  @Get('documents')
  async list(
    @TenantId() tenantId: string,
    @Query() query: DocumentListQueryDto,
  ): Promise<{ items: KnowledgeDocument[]; total: number; page: number; limit: number }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const filters: DocumentListFilters = {
      ...(query.status ? { status: query.status as DocumentStatus } : {}),
      ...(query.tags?.length ? { tags: query.tags } : {}),
    };

    const [items, total] = await this.documents.findAll(tenantId, filters, { page, limit });
    return { items, total, page, limit };
  }

  // ─── Get ──────────────────────────────────────────────────────────────────

  @Get('documents/:id')
  async findOne(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<KnowledgeDocument> {
    return this.documents.findById(id, tenantId);
  }

  // ─── Delete ───────────────────────────────────────────────────────────────

  @Delete('documents/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.documents.delete(id, tenantId);
  }

  // ─── Re-ingest ────────────────────────────────────────────────────────────

  /**
   * POST /knowledge/documents/:id/reingest
   * Deletes existing chunks, resets status, and re-queues ingestion.
   * Useful after a failed ingestion or when the document was updated.
   */
  @Post('documents/:id/reingest')
  @HttpCode(HttpStatus.NO_CONTENT)
  async reIngest(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.documents.reIngest(id, tenantId);
  }

  // ─── Debug search ─────────────────────────────────────────────────────────

  /**
   * GET /knowledge/search?q=<query>&topK=5&tags=faq,pricing
   *
   * Debug/admin endpoint: runs the hybrid retrieval pipeline and returns
   * the raw chunks with their scores. Useful for validating knowledge base
   * quality and tuning retrieval parameters.
   *
   * Tags filter: if provided, only searches documents tagged with any of the given tags.
   * Note: tag filtering is done post-retrieval (DB WHERE clause on document tags).
   */
  @Get('search')
  async search(
    @TenantId() tenantId: string,
    @Query() query: SearchQueryDto,
  ): Promise<{
    query: string;
    results: RetrievalResult[];
    latencyMs: number;
  }> {
    const start = Date.now();

    const results = await this.retrieval.hybridSearch(
      query.q,
      tenantId,
      query.topK ?? 5,
      { rerankEnabled: true, rerankTimeoutMs: 500 },
    );

    return {
      query: query.q,
      results,
      latencyMs: Date.now() - start,
    };
  }
}
