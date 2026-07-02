-- The default database (POSTGRES_DB=core_db) is created automatically by the
-- Postgres entrypoint. Here we create the per-service databases and enable pgvector.
-- NOTE: this runs ONLY on a fresh volume. On an existing volume, create new DBs
-- manually: psql -U root -d postgres -c "CREATE DATABASE <name>".

CREATE DATABASE auth_db;
CREATE DATABASE notification_db;
CREATE DATABASE search_db;

-- Enable pgvector on core_db for embeddings / semantic search (Cortex — Phase 4).
\c core_db
CREATE EXTENSION IF NOT EXISTS vector;

-- search-service owns search_db (KnowledgeChunk + pgvector semantic index).
\c search_db
CREATE EXTENSION IF NOT EXISTS vector;
