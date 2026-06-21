# 🏗️ SETUP — Cách dựng source này (Build & Init Method)

> **Cortex là một project THẬT** (B2B AI knowledge hub) — **KHÔNG phải template**. Tài liệu này lưu lại
> **phương pháp + thứ tự + quyết định** đã dùng để dựng codebase này (Turborepo monorepo + Hexagonal/CQRS
> services + Event-driven infra + **AI Agent Workflow**).
>
> 🎯 **Mục đích:** để **lần sau scaffold một source MỚI có init y hệt nhưng business RỖNG** —
> skeleton + infra + AI-workflow, không kèm domain Cortex.
>
> Cách đọc manifest §2: hàng **`skeleton`** = phần tái dùng (copy sang repo mới); hàng **`content`** =
> đặc thù Cortex (để trống / viết lại khi scaffold). Nội dung "lịch sử nhưng đúng" (migration SOPs, init
> scripts) gom về đây thay vì rải rác trong `directives/`; script gốc một-lần ở `docs/archive/`.
>
> ⚠️ Doc này là **công thức + manifest**. Để scaffold skeleton-rỗng **kiểm chứng 100%** cần thêm
> **init script đã chạy thử** (xem §8) — sẽ làm khi bạn yêu cầu dựng source mới.

---

## 1. Prerequisites

| Tool | Version | Dùng cho |
|---|---|---|
| Node.js | ≥ 20 | Turborepo, services, hooks (`sync.cjs`, `doc-select.cjs`) |
| npm | ≥ 10 | Workspaces (`apps/*`, `packages/*`) |
| Docker + Compose | mới | Infra (Postgres+pgvector, Redis, Kafka, ES, Prometheus/Grafana) + agent-sandbox |
| Python | 3.10+ | `.ai/knowledge_builder.py` + `execution/*.py` (chạy trong `agent-sandbox`, KHÔNG host) |
| Git | — | Submodules cho service repos |

---

## 2. Cấu trúc repo (manifest)

> Cột **Loại**: `skeleton` = copy gần như nguyên trạng khi clone; `content` = viết lại theo dự án mới.

| Path | Loại | Vai trò |
|---|---|---|
| `package.json` (root) | skeleton | Workspaces `apps/*`,`packages/*` + scripts (`build/dev/db:*/infra:*/agent:*/sync*`) |
| `turbo.json` | skeleton | Turborepo pipeline (build/lint/test/dev/db:generate) |
| `tsconfig.base.json` / `tsconfig.json` | skeleton | TS base + path alias `@/` |
| `apps/` | content | Services. Hiện: `auth-service` (Fastify), `core-api` (NestJS) — **git submodules**; `notification/chat/worker-service` scaffold |
| `packages/shared-kernel` | skeleton+ | Abstractions: CQRS bus, logger (Pino), HTTP response utils, errors |
| `directives/` | skeleton | SOP "luật bất biến" (CQRS, multi-tenancy, DB, logging, testing, zod…) |
| `docs/` | content | `01..11` business/design docs (VN + `docs/en`); `archive/` = script lịch sử |
| `.ai/` | skeleton | **Hệ tri thức** — xem §5 |
| `.claude/` | skeleton | `settings.json` (hooks) + `hooks/doc-select.cjs` |
| `scripts/sync.cjs` | skeleton | Smart-sync (Stop hook) — xem §5 |
| `execution/` | skeleton | Python tools cho agent-sandbox (memory, validate-architecture…) |
| `docker-compose.yml` | skeleton | Infra prod-like |
| `docker-compose.agent.yml` + `docker-init/Dockerfile.agent` | skeleton | **agent-sandbox** (Layer 0) chạy python an toàn |
| `docker-init/` | content | `init-dbs.sql` (pgvector), `nginx.conf`, `prometheus/`, `grafana/` |
| `AGENTS.md` | skeleton | Instruction agent canonical; `CLAUDE.md` = thin pointer |
| `readme.md` / `readme.phases.md` | content | Overview + roadmap 8 phase |

---

## 3. Init sequence (dựng từ số 0)

```bash
# 1. Skeleton
mkdir <project> && cd <project> && git init
#    copy: package.json, turbo.json, tsconfig*.json, .gitignore

# 2. Workspaces
mkdir -p apps packages
#    packages/shared-kernel (copy skeleton), apps/<service> (NestJS/Fastify)

# 3. Cài đặt
npm install
npm run build            # turbo build shared-kernel trước

# 4. Infra
npm run infra:up         # docker-compose up -d (Postgres:15432, Redis, Kafka, ES, Prom/Grafana)
npm run agent:up         # agent-sandbox cho python

# 5. AI Workflow (§5) — copy directives/, .ai/, .claude/, scripts/, AGENTS.md
docker exec agent-sandbox python .ai/knowledge_builder.py   # sinh KNOWLEDGE_INDEX lần đầu

# 6. Per-service: prisma
npm run db:generate
```

**Acceptance:** `docker-compose up -d` không lỗi · `npx turbo run dev` chạy mọi app · `KNOWLEDGE_INDEX.md` sinh được.

---

## 4. Turborepo (chắt từ `setup_turborepo` lịch sử)

- `workspaces: ["apps/*","packages/*"]` ở root `package.json`.
- `turbo.json`: pipeline `build`(dependsOn `^build`), `dev`(persistent), `lint`,`test`,`db:generate`.
- Path alias `@/` map qua `tsconfig.base.json` + `moduleNameMapper` (Jest).
- Bản migration gốc (rename `core-service`→`core-api`): `docs/archive/setup_turborepo.{md,py}` — chỉ là provenance, KHÔNG cần cho repo mới.

---

## 5. Hệ AI Agent Workflow (phần khác biệt — đây là "sản phẩm")

Đây là thứ làm repo này không chỉ là monorepo. 4 mảnh:

### 5a. `directives/` — luật bất biến (Layer 1)
SOP markdown. Agent đọc trước khi code. Builder trích heading vào `KNOWLEDGE_INDEX §3`.

### 5b. `.ai/` — hệ tri thức (Layer 3)
| File | Cơ chế |
|---|---|
| `knowledge_builder.py` | Generator: scan directives+docs+memory+`apps/*/src/modules`+curated → sinh `KNOWLEDGE_INDEX.md` |
| `KNOWLEDGE_INDEX.md` | **Auto-generated. ĐỪNG sửa tay** (sẽ bị ghi đè). 7 section |
| `PROJECT_STATUS.md` | **Curated** — inject thành §2 (phase %, next task). Cập nhật sau mỗi task |
| `QUICK_REFERENCE.md` | **Curated** — inject thành §4 (rule tra nhanh) |
| `memory/*.jsonl` | Experience buffer (errors/architecture/conventions/gotchas). Gitignored |

> **Self-check chống stale:** §2 auto-detect module-map đọc `apps/*/src/modules` mỗi lần regenerate → nếu
> curated nói dối, lệch hiện ngay trong index. (Bài học rút từ vụ `docs/11` stale.)

### 5c. `.claude/` + `scripts/sync.cjs` — automation (Layer 0 trigger)
- `settings.json` → 2 hook:
  - **UserPromptSubmit** `hooks/doc-select.cjs` — ép đọc doc liên quan trước khi làm.
  - **Stop** `scripts/sync.cjs` — sau mỗi lượt agent: detect git change → chạy đúng pipeline cần:
    `shared-kernel/src` → turbo build · `prisma/` → db:generate · `directives|docs|.ai/memory|.ai/PROJECT_STATUS|.ai/QUICK_REFERENCE` → regenerate index.
  - Không đổi gì relevant → trả về <100ms.

### 5d. `AGENTS.md` (+ `CLAUDE.md` pointer)
Instruction canonical: Session-Start Protocol, Rules #0–#3, After-Task Protocol (log memory + sync docs + update PROJECT_STATUS).

---

## 6. Infra (docker)

- `docker-compose.yml`: Postgres+**pgvector** (`15432`), Redis (`6379`), Kafka KRaft (`9092`), Elasticsearch (`9200`), Prometheus+Grafana.
- `docker-init/init-dbs.sql`: tạo DB + enable `vector` extension.
- `docker-compose.agent.yml` + `Dockerfile.agent`: **agent-sandbox** read-only chạy python (Rule #0: không host python).

---

## 7. Submodules

`.gitmodules` trỏ `apps/auth-service`, `apps/core-api` sang repo riêng. **Lưu ý khi clone/worktree:**
worktree KHÔNG tự checkout submodule → code service chỉ có ở main checkout. Quyết định cho repo mới:
giữ submodule (tách service repo) **hoặc** inline trong monorepo — tuỳ mục tiêu.

---

## 8. Scaffold source mới (business rỗng) — trạng thái & việc còn lại

Mục tiêu: từ doc này, dựng một repo **MỚI** có init y hệt (skeleton + infra + AI-workflow) nhưng
**KHÔNG** có business Cortex. Doc đủ để **dựng tay**. Để **tự động hoá + kiểm chứng 100%**, cần:

1. **`scripts/init-project.sh`** (chưa có) — copy các hàng `skeleton`, để trống các hàng `content`, sinh index, **đã chạy thử** trên thư mục rỗng.
2. **Manifest assert** — kiểm mọi file `skeleton` tồn tại sau init (máy xác nhận, không tin prose — giống §2 auto-detect).
3. Quyết định submodule vs inline (§7).

> Khi bạn nhờ dựng source mới, tôi viết + **chạy thử** init script rồi mới khẳng định 100% —
> không tuyên bố 100% từ một doc chưa validate (đúng nguyên tắc chống parroting của dự án).
