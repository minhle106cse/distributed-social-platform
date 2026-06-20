# 📋 AGENT DIRECTIVES (LAYER 1 SOPs)

Welcome to the **Layer 1: Directives** directory of our 3-layer agent architecture. 

Directives are **Standard Operating Procedures (SOPs)** written in Markdown. They define *what* the agent needs to accomplish and *how* to coordinate Layer 3 execution scripts to achieve deterministic outcomes.

---

## 🏗️ The 3-Layer Paradigm

```
┌───────────────────────────────────────────┐
│ Layer 1: Directive (SOPs in Markdown)     │ <-- You are here
└─────────────────────┬─────────────────────┘
                      │ Reads instructions
                      v
┌───────────────────────────────────────────┐
│ Layer 2: Orchestration (Agent Routing)    │ <-- Decision & error handling
└─────────────────────┬─────────────────────┘
                      │ Executes
                      v
┌───────────────────────────────────────────┐
│ Layer 3: Execution (Deterministic Python) │ <-- Python scripts in /execution
└───────────────────────────────────────────┘
```

---

## 📝 Directive Specification Template

Every directive file in this directory should follow this standardized template to ensure clarity, consistency, and reliability. 

### Recommended File Format: `directives/<action_name>.md`

```markdown
# SOP: [Short, Active Title]

> [!NOTE]
> Provide a brief 2-sentence description of the goal of this SOP and the business value it delivers.

## 🎯 Goal
A precise, bulleted list of the exact outcomes that must be achieved.

## 📥 Inputs & Requirements
What files, variables, or environment setup is required before executing this SOP?
- `INPUT_PARAM_1`: Description of the parameter.
- `.env` variables required: e.g., `DB_HOST`, `REDIS_PORT`.

## 🛠️ Execution Plan & Scripts
The precise, ordered list of Layer 3 execution scripts to run.

1. **Step 1: Prep / Validate**
   - Script: `execution/validate_inputs.py`
   - Purpose: Checks that all inputs are present and formatted correctly.
2. **Step 2: Processing**
   - Script: `execution/run_processing.py`
   - Purpose: The core script doing the heavy lifting.
3. **Step 3: Export / Delivery**
   - Script: `execution/generate_deliverable.py`
   - Purpose: Generates the final output (e.g., Google Sheet, SQL migration, etc.).

## 📤 Expected Outputs
A clear definition of what constitutes a successful run.
- **Intermediates** (placed in `.tmp/`):
  - `.tmp/raw_data.json`
- **Deliverables**:
  - `apps/auth-service/...` (or Cloud-based links if applicable)

## ⚠️ Edge Cases & Failure Handling
What should the agent do when something goes wrong?
- **Invalid Credentials**: Stop and notify the user immediately. Do not attempt retries.
- **Network Timeouts**: Attempt up to 3 retries with exponential backoff.
- **Database Connection Failure**: Log the connection error and verify local PostgreSQL docker container state.
```

---

## 📚 Directive Index

| File | Mô tả | Đọc khi |
|---|---|---|
| `cqrs_pattern.md` | CQRS Middleware Pipeline, AsyncLocalStorage, Transaction | Viết module mới, Handler, Repository |
| `folder_structure_sop.md` | Cấu trúc thư mục chuẩn, forbidden patterns | Tạo file mới bất kỳ |
| `database_standard.md` | Naming, UUID PK, soft delete, Prisma v7 config | Thiết kế schema, Prisma config |
| `microservice_architecture.md` | Bootstrap checklist, logger, health/metrics | Init service mới, config service |
| `logging_standard.md` | Dual-log, shared-kernel HTTP utilities | HTTP layer, interceptors, filters |
| `zod_validation.md` | Schema location, Fastify + NestJS patterns | Viết API endpoint |
| `testing_standard.md` | Co-location, mock pattern, ESM handling | Viết test |
| `qa_standard.md` | Zero Trust, Active Reflection, verification workflow | Hoàn thành task |
| `multi_tenancy.md` | orgId isolation, tenant context, RBAC scope | Mọi module có data per-org |
| `event_sourcing.md` | EventStore, OCC, projection, snapshot | Credit, Reputation modules |
| `rag_ai_integration.md` | Hybrid search, pgvector, Elasticsearch, Circuit Breaker | AI/Search features |
| `memory_sop.md` | Session start protocol, memory categories, knowledge update | Đầu mỗi session |

---

## 🔄 The Self-Annealing Lifecycle

When executing a directive, if a script in Layer 3 fails:
1. **Analyze**: Read the stack trace or error message thoroughly.
2. **Fix**: Repair the Python script in `execution/` (do not try to bypass it with manual hacks).
3. **Validate**: Test the fixed script.
4. **Document**: If the error was due to an undocumented API limit, dependency quirk, or environment nuance, **update the relevant directive** immediately with the newly learned constraint.

---

*Build less vanity. Build more survivability.*
