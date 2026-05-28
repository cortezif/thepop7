-- pgvector setup — rodar UMA vez depois do `prisma migrate dev`.
-- Idempotente.

CREATE EXTENSION IF NOT EXISTS vector;

-- HNSW na coluna embedding (cosine distance).
-- Sem dados não custa nada; com 10k+ produtos faz a busca semântica em ms.
CREATE INDEX IF NOT EXISTS products_embedding_hnsw
  ON products USING hnsw (embedding vector_cosine_ops);
