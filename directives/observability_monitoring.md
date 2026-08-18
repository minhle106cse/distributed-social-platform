# SOP: Observability & Monitoring Stack (Prometheus + Grafana)

## 📌 When to read this directive

- When adding a new metric (Counter/Gauge/Histogram) to a service.
- When adding/changing an alert rule or a dashboard panel.
- When debugging "why isn't Grafana/Prometheus showing any data".
- **Do NOT** read this directive to relearn YAML syntax from scratch every time — see §5 Scope Note
  first.

## 1. Stack Topology

```
[App /metrics] ──┐
[exporters]  ─────┼──► Prometheus (:9090, scrape 15s) ──► Grafana (:3000)
[Kafka] ──────────┘
[Kafka] ──► kafka-exporter (:9308) ──► Prometheus
[Kafka] ──► Kafka UI (:8080) — direct, not through Prometheus
```

Everything sits behind the `monitoring` compose profile (off by default, to keep dev machines
light):

```bash
docker compose --profile monitoring up -d
```

| Component | URL | Auth |
|---|---|---|
| Prometheus | `http://localhost:9090` | Basic auth via the nginx proxy (`docker-init/.htpasswd`) — `admin`/`admin` |
| Grafana | `http://localhost:3000` | Form login — `GRAFANA_USER`/`GRAFANA_PASSWORD` in `.env` (defaults `admin`/`admin`) |
| Kafka UI | `http://localhost:8080` | Its own form login |

`auth-service`, `core-api`, `notification-service` and `search-service` run **on the host** (not
containerised), so Prometheus scrapes them via `host.docker.internal:400{1..4}`. A red target means
the service isn't started on the host — not a Prometheus misconfiguration.

## 2. Metric convention — Gauge vs Counter

- **Gauge** (instantaneous value, read directly): `kafka_consumergroup_lag`,
  `pg_stat_database_numbackends`, `elasticsearch_clusterinfo_up`.
- **Counter** (only increases, MUST be wrapped in `rate()` to mean anything): `notification_dlq_total`,
  `notification_handler_retry_total`, `search_chunks_indexed_total`. Reading a Counter's absolute
  value is meaningless.
- Custom app metrics live in `apps/<service>/src/infrastructure/observability/<service>.metrics.ts` —
  this is where "what is worth measuring" is decided, and it belongs to backend scope (see §5).

## 3. Recording Rules (`docker-init/prometheus/rules.yml`)

These shorten frequently-used PromQL into fixed names, so you don't retype `rate(...[5m])` every
time, and so the "formula" is separated from the "display" (a dashboard just references the rule
name).

| Rule | Formula | Meaning |
|---|---|---|
| `notification:dlq_rate5m` | `rate(notification_dlq_total[5m])` | The notification pipeline has genuine dead-letters |
| `notification:handler_retry_rate5m` | `rate(notification_handler_retry_total[5m])` | A handler is hitting transient errors |
| `notification:dedup_skipped_rate5m` | `rate(notification_dedup_skipped_total[5m])` | Idempotency is working (redeliveries are being blocked correctly) |
| `search:dlq_rate5m` | `rate(search_dlq_total[5m])` | The RAG indexing pipeline is dropping events |
| `search:handler_retry_rate5m` | `rate(search_handler_retry_total[5m])` | |
| `search:chunks_indexed_rate5m` | `rate(search_chunks_indexed_total[5m])` | Embedding-pipeline throughput |
| `kafka:consumergroup_lag_by_group` | `sum by (consumergroup, topic) (kafka_consumergroup_lag)` | Aggregate lag by group/topic |
| `postgres:app_connections` | `sum by (datname) (pg_stat_database_numbackends{datname=~"core_db\|auth_db\|notification_db\|search_db"})` | Filters out noise from `template0/template1/postgres` (Postgres system DBs, always present, unrelated to the app) |

To add a rule → edit `rules.yml`; the mount already exists in `docker-compose.yml` (the `prometheus`
service), so you only need `docker compose --profile monitoring restart prometheus`.

## 4. Grafana provisioning-as-code

**Do NOT create dashboards/alerts by hand through the UI in this project** — everything lives in
`docker-init/grafana/provisioning/` and is committed to git, so dashboards/alerts are available on
any machine that clones the repo (not dependent on the `grafana_data` volume).

```
docker-init/grafana/provisioning/
├── datasources/datasource.yml      # Prometheus datasource, uid: prometheus (FIXED — panels/alerts reference this uid)
├── dashboards/
│   ├── dashboard.yml                # provider — points Grafana at this directory
│   └── cortex-overview.json         # 8 panels: lag, dlq×2, retry, dedup-skip, chunks-indexed, pg-connections, es-reachable
└── alerting/
    ├── contactpoints.yaml           # where alerts go (currently a webhook placeholder, see the gotcha below)
    ├── policies.yaml                # routes every alert → the contact point
    └── rules.yaml                   # 5 alert rules (§4.1)
```

### 4.1 Current alert rules

| Rule | Condition | Severity | Why |
|---|---|---|---|
| Service Down | `up{job=~"core-api\|auth-service\|notification-service\|search-service"} < 1` for 1m | critical | The app has stopped serving `/metrics` |
| Notification DLQ Rate Above Zero | `notification:dlq_rate5m > 0` for 2m | warning | A genuine dead-letter, not a transient retry |
| Search DLQ Rate Above Zero | `search:dlq_rate5m > 0` for 2m | warning | RAG indexing is dropping events |
| Kafka Consumer Lag Stuck High | `kafka:consumergroup_lag_by_group > 50` for 5m | warning | Lag is *accumulating*, not just fluctuating |
| Elasticsearch Unreachable | `elasticsearch_clusterinfo_up < 1` for 2m | warning | Hybrid Search will degrade |

The threshold principle: **DLQ uses `> 0`** (any dead-letter in an event-driven system is a bug, so
no higher threshold is needed), unlike **lag, which uses `> 50` + `for: 5m`** (lag naturally
fluctuates with traffic, so only alert when it accumulates over time).

### 4.2 ⚠️ Gotcha — changing a datasource `uid` after it has been provisioned once → Grafana crash-loops

**Error:** `Failed to provision data sources: Datasource provisioning error: data source not found`
→ the container restart-loops forever and `:3000` never comes up.

**Cause:** Grafana persists the old datasource record (with its auto-generated UID) in the
`grafana_data` volume. Adding a fixed `uid:` field to `datasource.yml` after it has already run once
means the old record no longer matches the new UID → provisioning reconcile fails → the entire
`provisioning` module fails → the container never becomes healthy.

**Fix:** add `deleteDatasources` at the top of `datasource.yml` so Grafana cleans up the old record
by name before recreating it with the fixed UID:

```yaml
deleteDatasources:
  - name: Prometheus
    orgId: 1
```

No need to delete the volume. Apply this same principle if any other datasource's UID is ever
changed later.

### 4.3 Current limitation — the contact point isn't wired to real notifications

`contactpoints.yaml` points its webhook at `http://host.docker.internal:9999/grafana-alerts` —
**nothing is listening there**. Alerts still transition Normal→Pending→Firing correctly and show up
in the Grafana UI (Alerting → Alert rules), but **no notification leaves the system** (no
Slack/email). To receive them for real, change the `url` to a real Slack incoming webhook or
configure SMTP — nothing in `rules.yaml`/`policies.yaml` needs to change.

## 5. ⚠️ Scope note — what the backend MUST remember vs what's left to AI/platform tooling

An explicit decision (2026-07-09) to avoid spreading learning too thin: **own the WHY/WHAT, don't own
the HOW (the syntax)**.

**The backend MUST understand deeply, and must not forget** (this is system design, living in app
code):

- Deciding which metrics are worth measuring and why (the 5 counters in
  `notification.metrics.ts`/`search.metrics.ts`).
- Reading/interpreting the numbers when debugging — distinguishing Gauge from Counter, reading
  lag/rate correctly.
- Designing alert thresholds and the reasoning behind them (see §4.1) — that is an SLO/reliability
  decision, not syntax.

**Outside backend IC scope — understanding the concept is enough, no need to memorise the syntax:**

- The provisioning YAML syntax for Prometheus recording rules and Grafana's 3-stage alerting pipeline
  (`reduce`→`threshold`), nginx reverse-proxy config, docker-compose exporter wiring. That is
  Platform/SRE engineering — reach for AI or the docs each time it's needed, don't memorise it.

## 🔗 Related

- `directives/logging_standard.md` — Pino structured logging (a different observability axis than
  metrics)
- `directives/resilience_patterns.md` — DLQ/retry are the source of the counters alerted on here
- `directives/idempotency_strategy.md` — the source of `notification_dedup_skipped_total`
- `docs/linkedin_posts_plan.md` #35 "Observability: Distributed Tracing + Metrics + Structured
  Logging" — this directive's content is the main raw material for that post
