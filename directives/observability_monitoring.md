# SOP: Observability & Monitoring Stack (Prometheus + Grafana)

## 📌 Khi nào đọc directive này
- Khi thêm 1 metric mới (Counter/Gauge/Histogram) vào 1 service.
- Khi thêm/sửa alert rule hoặc dashboard panel.
- Khi debug "tại sao Grafana/Prometheus không lên số liệu".
- **Không** đọc directive này để học cú pháp YAML từ đầu mỗi lần — xem §5 Scope Note trước.

## 1. Stack Topology

```
[App /metrics] ──┐
[exporters]  ─────┼──► Prometheus (:9090, scrape 15s) ──► Grafana (:3000)
[Kafka] ──────────┘
[Kafka] ──► kafka-exporter (:9308) ──► Prometheus
[Kafka] ──► Kafka UI (:8080) — trực tiếp, không qua Prometheus
```

Toàn bộ nằm sau compose profile `monitoring` (tắt mặc định để dev nhẹ máy):
```bash
docker compose --profile monitoring up -d
```

| Thành phần | URL | Auth |
|---|---|---|
| Prometheus | `http://localhost:9090` | Basic auth qua nginx proxy (`docker-init/.htpasswd`) — `admin`/`admin` |
| Grafana | `http://localhost:3000` | Form login — `GRAFANA_USER`/`GRAFANA_PASSWORD` trong `.env` (mặc định `admin`/`admin`) |
| Kafka UI | `http://localhost:8080` | Form login riêng |

`auth-service`, `core-api`, `notification-service`, `search-service` chạy **trên host** (không containerize), Prometheus scrape qua `host.docker.internal:400{1..4}`. Nếu target đỏ = service chưa start trên host, không phải lỗi Prometheus.

## 2. Metric convention — Gauge vs Counter

- **Gauge** (giá trị tức thời, đọc thẳng): `kafka_consumergroup_lag`, `pg_stat_database_numbackends`, `elasticsearch_clusterinfo_up`.
- **Counter** (chỉ tăng, PHẢI bọc `rate()` mới có ý nghĩa): `notification_dlq_total`, `notification_handler_retry_total`, `search_chunks_indexed_total`. Đọc số tuyệt đối của Counter là vô nghĩa.
- Custom app metric sống ở `apps/<service>/src/infrastructure/observability/<service>.metrics.ts` — đây là nơi quyết định "cái gì đáng đo", thuộc scope backend (xem §5).

## 3. Recording Rules (`docker-init/prometheus/rules.yml`)

Rút gọn PromQL hay dùng thành tên cố định, tránh phải gõ lại `rate(...[5m])` mỗi lần và tách "công thức tính" khỏi "nơi hiển thị" (dashboard chỉ tham chiếu tên rule).

| Rule | Công thức | Ý nghĩa |
|---|---|---|
| `notification:dlq_rate5m` | `rate(notification_dlq_total[5m])` | Notification pipeline có dead-letter thật |
| `notification:handler_retry_rate5m` | `rate(notification_handler_retry_total[5m])` | Handler đang gặp lỗi transient |
| `notification:dedup_skipped_rate5m` | `rate(notification_dedup_skipped_total[5m])` | Idempotency có hoạt động (redelivery bị chặn đúng) |
| `search:dlq_rate5m` | `rate(search_dlq_total[5m])` | RAG indexing pipeline rớt event |
| `search:handler_retry_rate5m` | `rate(search_handler_retry_total[5m])` | |
| `search:chunks_indexed_rate5m` | `rate(search_chunks_indexed_total[5m])` | Throughput embedding pipeline |
| `kafka:consumergroup_lag_by_group` | `sum by (consumergroup, topic) (kafka_consumergroup_lag)` | Lag tổng hợp theo group/topic |
| `postgres:app_connections` | `sum by (datname) (pg_stat_database_numbackends{datname=~"core_db\|auth_db\|notification_db\|search_db"})` | Loại bỏ noise từ `template0/template1/postgres` (DB hệ thống Postgres, luôn có sẵn, không liên quan app) |

Thêm rule mới → sửa `rules.yml`, mount đã có sẵn trong `docker-compose.yml` (service `prometheus`), chỉ cần `docker compose --profile monitoring restart prometheus`.

## 4. Grafana provisioning-as-code

**KHÔNG tạo dashboard/alert bằng tay qua UI cho project này** — mọi thứ sống trong `docker-init/grafana/provisioning/` và commit vào git, để dashboard/alert tự có sẵn ở bất kỳ máy nào clone repo (không phụ thuộc `grafana_data` volume).

```
docker-init/grafana/provisioning/
├── datasources/datasource.yml      # datasource Prometheus, uid: prometheus (CỐ ĐỊNH — panel/alert reference qua uid này)
├── dashboards/
│   ├── dashboard.yml                # provider — trỏ Grafana đọc dashboard từ thư mục này
│   └── cortex-overview.json         # 8 panel: lag, dlq×2, retry, dedup-skip, chunks-indexed, pg-connections, es-reachable
└── alerting/
    ├── contactpoints.yaml           # nơi nhận alert (hiện là webhook placeholder, xem gotcha bên dưới)
    ├── policies.yaml                # route mọi alert → contact point
    └── rules.yaml                   # 5 alert rule (§4.1)
```

### 4.1 Alert rules hiện có

| Rule | Điều kiện | Severity | Vì sao |
|---|---|---|---|
| Service Down | `up{job=~"core-api\|auth-service\|notification-service\|search-service"} < 1` trong 1m | critical | App ngừng trả `/metrics` |
| Notification DLQ Rate Above Zero | `notification:dlq_rate5m > 0` trong 2m | warning | Dead-letter thật, không phải retry thoáng qua |
| Search DLQ Rate Above Zero | `search:dlq_rate5m > 0` trong 2m | warning | RAG indexing đang rớt event |
| Kafka Consumer Lag Stuck High | `kafka:consumergroup_lag_by_group > 50` trong 5m | warning | Lag *tích tụ*, không phải dao động nhất thời |
| Elasticsearch Unreachable | `elasticsearch_clusterinfo_up < 1` trong 2m | warning | Hybrid Search sẽ degrade |

Nguyên tắc chọn ngưỡng: **DLQ dùng `> 0`** (bất kỳ dead-letter nào trong hệ event-driven đều là bug, không cần ngưỡng cao) khác với **lag dùng `> 50` + `for: 5m`** (lag dao động tự nhiên theo traffic, chỉ alert khi tích tụ kéo dài).

### 4.2 ⚠️ Gotcha — đổi `uid` datasource sau khi đã provision 1 lần → Grafana crash-loop

**Lỗi:** `Failed to provision data sources: Datasource provisioning error: data source not found` → container restart loop vĩnh viễn, `:3000` không bao giờ up.

**Nguyên nhân:** Grafana lưu record datasource cũ (UID tự sinh) trong `grafana_data` volume. Thêm field `uid:` cố định vào `datasource.yml` sau khi đã chạy 1 lần → record cũ không khớp UID mới → provisioning reconcile fail → toàn bộ `provisioning` module fail → container không bao giờ healthy.

**Fix:** thêm `deleteDatasources` vào đầu `datasource.yml` để Grafana tự dọn record cũ theo tên trước khi tạo lại với UID mới:
```yaml
deleteDatasources:
  - name: Prometheus
    orgId: 1
```
Không cần xóa volume. Áp dụng lại nguyên tắc này nếu sau này đổi UID bất kỳ datasource nào khác.

### 4.3 Giới hạn hiện tại — contact point chưa nối notification thật

`contactpoints.yaml` trỏ webhook tới `http://host.docker.internal:9999/grafana-alerts` — **chưa có gì lắng nghe ở đó**. Alert vẫn chuyển trạng thái Normal→Pending→Firing đúng và hiển thị trong Grafana UI (Alerting → Alert rules), nhưng **không có thông báo ra ngoài** (Slack/email). Khi cần nhận thật, đổi `url` sang Slack incoming webhook thật hoặc cấu hình SMTP — không cần đổi gì ở `rules.yaml`/`policies.yaml`.

## 5. ⚠️ Scope note — cái gì backend PHẢI nhớ, cái gì để AI/platform tooling xử lý

Quyết định rõ ràng (2026-07-09) để tránh việc học dàn trải: **sở hữu WHY/WHAT, không sở hữu HOW (cú pháp)**.

**Backend PHẢI hiểu sâu, không được quên** (đây là thiết kế hệ thống, nằm trong code app):
- Quyết định metric nào đáng đo và tại sao (5 counter trong `notification.metrics.ts`/`search.metrics.ts`).
- Đọc/diễn giải số liệu khi debug — phân biệt Gauge/Counter, đọc lag/rate đúng nghĩa.
- Thiết kế ngưỡng alert & lý do (xem §4.1) — đây là quyết định SLO/reliability, không phải cú pháp.

**Ngoài scope backend IC — hiểu khái niệm là đủ, không cần nhớ cú pháp:**
- Cú pháp YAML provisioning của Prometheus recording rules / Grafana alerting 3-stage pipeline (`reduce`→`threshold`), nginx reverse-proxy, docker-compose exporter wiring. Đây là Platform/SRE engineering — dùng AI hoặc docs mỗi lần cần, không memorize.

## 🔗 Liên quan
- `directives/logging_standard.md` — Pino structured logging (khác observability qua metrics)
- `directives/resilience_patterns.md` — DLQ/retry là nguồn của các counter được alert ở đây
- `directives/idempotency_strategy.md` — nguồn của `notification_dedup_skipped_total`
- `docs/linkedin_posts_plan.md` #35 "Observability: Distributed Tracing + Metrics + Structured Logging" — nội dung directive này là nguyên liệu chính cho bài đó
