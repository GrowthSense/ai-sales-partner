import { Injectable, Logger } from '@nestjs/common';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChunkSourceMetadata {
  documentId: string;
  tenantId: string;
  documentTitle: string;
  sourceUrl?: string;
  pageNumber?: number;
  sectionHeading?: string;
}

export interface ChunkDraft {
  content: string;
  tokenCount: number;
  metadata: {
    chunkIndex: number;
    pageNumber?: number;
    sectionHeading?: string;
    startChar: number;
    endChar: number;
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Target chunk size in tokens.
 * 512 tokens ≈ 384 words ≈ optimal for text-embedding-3-small.
 * Large enough for context, small enough for specificity.
 */
const CHUNK_SIZE_TOKENS = 512;

/**
 * Overlap between consecutive chunks.
 * 100 tokens prevents answers from being split at chunk boundaries.
 */
const CHUNK_OVERLAP_TOKENS = 100;

/**
 * Separator hierarchy for recursive splitting (high → low priority).
 * Chunk at the highest-priority boundary that keeps size ≤ CHUNK_SIZE_TOKENS.
 */
const SEPARATORS = [
  '\n\n\n',  // section breaks
  '\n\n',    // paragraph breaks
  '\n',      // line breaks
  '. ',      // sentence boundaries
  '! ',
  '? ',
  '; ',
  ', ',
  ' ',       // word boundaries
  '',        // character level (last resort)
];

/**
 * Rough token estimate: 1 token ≈ 3.8 characters for English text.
 * js-tiktoken is more accurate but adds ~3MB to the bundle and
 * synchronous CPU cost per chunk. For chunking we accept ±5% error.
 * Swap this function for tiktoken encode().length for exact counts.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.8);
}

/**
 * ChunkingService — recursive character-based text splitter.
 *
 * Algorithm:
 *  1. Try splitting on the highest-priority separator
 *  2. If a piece is still > CHUNK_SIZE_TOKENS, recurse with the next separator
 *  3. Once pieces are small enough, merge consecutive pieces into chunks
 *     ensuring size ≤ CHUNK_SIZE_TOKENS with CHUNK_OVERLAP_TOKENS overlap
 *
 * Handles all source types:
 *  - PDF (text extracted per page by IngestionService)
 *  - DOCX (flat text from mammoth)
 *  - HTML (text stripped by cheerio)
 *  - TXT / Markdown (plain text)
 *  - FAQ / Product docs (structured plain text)
 *
 * Section headings are detected via simple regex and carried in metadata.
 */
@Injectable()
export class ChunkingService {
  private readonly logger = new Logger(ChunkingService.name);

  chunk(text: string, meta: ChunkSourceMetadata): ChunkDraft[] {
    if (!text.trim()) return [];

    // Extract section headings before splitting (for metadata enrichment)
    const headingMap = this.extractHeadings(text);

    // Recursive split
    const pieces = this.splitRecursive(text, SEPARATORS, CHUNK_SIZE_TOKENS);

    // Merge small pieces into properly-sized chunks with overlap
    const chunks = this.mergeWithOverlap(pieces, CHUNK_SIZE_TOKENS, CHUNK_OVERLAP_TOKENS);

    // Build ChunkDraft records
    const drafts: ChunkDraft[] = [];
    let charOffset = 0;

    for (let i = 0; i < chunks.length; i++) {
      const content = chunks[i].trim();
      if (!content) continue;

      const startChar = text.indexOf(content, Math.max(0, charOffset - 50));
      const endChar = startChar >= 0 ? startChar + content.length : charOffset + content.length;
      charOffset = endChar;

      // Find the nearest section heading before this chunk's start position
      const sectionHeading = this.nearestHeading(headingMap, startChar);

      drafts.push({
        content,
        tokenCount: estimateTokens(content),
        metadata: {
          chunkIndex: i,
          pageNumber: meta.pageNumber,
          sectionHeading: sectionHeading ?? meta.sectionHeading,
          startChar: Math.max(0, startChar),
          endChar,
        },
      });
    }

    this.logger.debug(
      `Chunked document ${meta.documentId}: ${text.length} chars → ${drafts.length} chunks`,
    );

    return drafts;
  }

  /**
   * Chunk text that comes structured by page (e.g. PDF parsed page-by-page).
   * Each page is chunked independently so pageNumber is always accurate.
   */
  chunkByPages(
    pages: Array<{ text: string; pageNumber: number }>,
    meta: Omit<ChunkSourceMetadata, 'pageNumber'>,
  ): ChunkDraft[] {
    const allDrafts: ChunkDraft[] = [];
    let globalIndex = 0;

    for (const { text, pageNumber } of pages) {
      const pageDrafts = this.chunk(text, { ...meta, pageNumber });
      for (const draft of pageDrafts) {
        allDrafts.push({
          ...draft,
          metadata: { ...draft.metadata, chunkIndex: globalIndex++, pageNumber },
        });
      }
    }

    return allDrafts;
  }

  // ─── Recursive splitting ─────────────────────────────────────────────────

  private splitRecursive(
    text: string,
    separators: string[],
    maxTokens: number,
  ): string[] {
    if (estimateTokens(text) <= maxTokens) return [text];
    if (separators.length === 0) return this.forceSplit(text, maxTokens);

    const [sep, ...remainingSeps] = separators;
    const splits = sep === '' ? [...text] : text.split(sep);

    if (splits.length === 1) {
      // This separator didn't split anything — try the next one
      return this.splitRecursive(text, remainingSeps, maxTokens);
    }

    const pieces: string[] = [];
    for (const split of splits) {
      const piece = split + (sep !== '' && sep !== ' ' ? '' : ''); // re-add separator context
      if (!piece.trim()) continue;

      if (estimateTokens(piece) <= maxTokens) {
        pieces.push(piece);
      } else {
        // Recurse with next separator
        pieces.push(...this.splitRecursive(piece, remainingSeps, maxTokens));
      }
    }

    return pieces;
  }

  /**
   * Last-resort: split by character count when no semantic separator works.
   */
  private forceSplit(text: string, maxTokens: number): string[] {
    const maxChars = Math.floor(maxTokens * 3.8);
    const pieces: string[] = [];
    for (let i = 0; i < text.length; i += maxChars) {
      pieces.push(text.slice(i, i + maxChars));
    }
    return pieces;
  }

  // ─── Merge with overlap ──────────────────────────────────────────────────

  /**
   * Merge small pieces into chunks of ≤ maxTokens.
   * Each chunk overlaps the previous by `overlapTokens` worth of text.
   */
  private mergeWithOverlap(
    pieces: string[],
    maxTokens: number,
    overlapTokens: number,
  ): string[] {
    const chunks: string[] = [];
    let currentPieces: string[] = [];
    let currentTokens = 0;

    for (const piece of pieces) {
      const pieceTokens = estimateTokens(piece);

      if (currentTokens + pieceTokens > maxTokens && currentPieces.length > 0) {
        // Emit current chunk
        chunks.push(currentPieces.join(' '));

        // Build overlap: walk backwards through current pieces collecting tokens
        const overlapPieces: string[] = [];
        let overlapCount = 0;
        for (let i = currentPieces.length - 1; i >= 0; i--) {
          const t = estimateTokens(currentPieces[i]);
          if (overlapCount + t > overlapTokens) break;
          overlapPieces.unshift(currentPieces[i]);
          overlapCount += t;
        }

        currentPieces = [...overlapPieces, piece];
        currentTokens = overlapPieces.reduce((s, p) => s + estimateTokens(p), 0) + pieceTokens;
      } else {
        currentPieces.push(piece);
        currentTokens += pieceTokens;
      }
    }

    if (currentPieces.length > 0) {
      chunks.push(currentPieces.join(' '));
    }

    return chunks;
  }

  // ─── Section heading extraction ──────────────────────────────────────────

  /**
   * Extract Markdown/document headings and their character positions.
   * Supports: # Heading, ## Heading, ALL CAPS lines, numbered sections "1. Title".
   */
  private extractHeadings(text: string): Map<number, string> {
    const map = new Map<number, string>();
    const patterns = [
      /^#{1,4}\s+(.+)$/m,           // Markdown headings
      /^([A-Z][A-Z\s]{5,60})$/m,    // ALL CAPS headings
      /^\d+\.\s+([A-Z].{5,80})$/m,  // Numbered sections
    ];

    for (const pattern of patterns) {
      const global = new RegExp(pattern.source, 'gm');
      let match: RegExpExecArray | null;
      while ((match = global.exec(text)) !== null) {
        const heading = match[1]?.trim() ?? match[0]?.trim();
        if (heading && heading.length > 3) {
          map.set(match.index, heading.slice(0, 200));
        }
      }
    }

    return map;
  }

  private nearestHeading(headings: Map<number, string>, charPos: number): string | undefined {
    let nearest: string | undefined;
    let nearestPos = -1;
    for (const [pos, heading] of headings) {
      if (pos <= charPos && pos > nearestPos) {
        nearestPos = pos;
        nearest = heading;
      }
    }
    return nearest;
  }
}
