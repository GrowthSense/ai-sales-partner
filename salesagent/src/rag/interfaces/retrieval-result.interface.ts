export interface RetrievalResult {
  chunkId: string;
  documentId: string;
  content: string;
  metadata: ChunkMetadata;
  semanticScore: number;
  keywordScore: number;
  fusedScore: number;
  rerankScore?: number;
}

export interface ChunkMetadata {
  documentTitle: string;
  sourceUrl?: string;
  pageNumber?: number;
  sectionHeading?: string;
  chunkIndex: number;
}
