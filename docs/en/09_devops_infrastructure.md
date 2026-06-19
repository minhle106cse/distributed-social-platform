# ☁️ DEVOPS & INFRASTRUCTURE — Cortex

> This English page mirrors the Vietnamese source of truth.
> Please refer to the [Vietnamese version](../09_devops_infrastructure.md) for the complete, compose-accurate document.

**Summary (synced with real `docker-compose.yml`):** Single PostgreSQL `pgvector/pgvector:pg16` on port `15432` hosting two logical DBs (`core_db`, `auth_db` via `docker-init/init-dbs.sql`). Kafka in **KRaft mode (no Zookeeper)**. Redis, Elasticsearch 8.10. Nginx api-gateway (proxies auth-service:4001, core-api:4002; basic-auth proxies for RedisInsight & Prometheus). Full observability: Prometheus + Grafana + node/postgres/redis/kafka/elasticsearch/nginx exporters; Kafka UI + Kibana. Service↔infra↔phase mapping documented. Notes: add `CREATE EXTENSION vector` to init-dbs.sql (Phase 4); update nginx routes to Cortex domains; AI sandbox via `docker-compose.agent.yml` (read-only mounts + `.tmp`/`.ai` rw).
