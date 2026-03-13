-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Enable trigram extension for BM25-style keyword search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Enable uuid-ossp for UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
