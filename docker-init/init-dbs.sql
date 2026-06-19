-- The default database (POSTGRES_DB=core_db) is created automatically by the
-- Postgres entrypoint. Here we create the auth-service database and enable pgvector.

CREATE DATABASE auth_db;

-- Enable pgvector on core_db for embeddings / semantic search (Cortex — Phase 4).
\c core_db
CREATE EXTENSION IF NOT EXISTS vector;
