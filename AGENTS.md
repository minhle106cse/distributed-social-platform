# Advanced Agent Instructions (Level 4/5)

> **AGENTS.md is the canonical agent instruction file.** `CLAUDE.md` and `GEMINI.md` are thin pointers to this file so the same instructions load in any AI environment. Edit instructions here.

## 📦 Project Context — Cortex (AI-Powered Team Knowledge Hub)

> The product is **Cortex**: a B2B **internal knowledge hub** for teams/companies, with **AI Discovery (RAG + Hybrid Search)**, an **event-sourced virtual credit economy**, reputation/gamification, and **multi-tenancy**. (This replaces the legacy "TeamFin" finance concept — do NOT reintroduce expense/settlement/Splitwise framing.)
>
> Business → infrastructure mapping is intentional: **pgvector** (semantic search), **Elasticsearch** (full-text → hybrid), **Kafka** (Outbox + re-index/re-embed events), **Redis** (cache, rate-limit, pub/sub), **chat/notification services** (realtime + AI assistant). Patterns showcased: Event Sourcing (credit ledger), CQRS, Saga (AI-query/bounty), Outbox, Idempotency, OCC, Circuit Breaker (around Claude), Rate Limiting, Tenant Isolation.
>
> Source of truth for product/business: read `.ai/KNOWLEDGE_INDEX.md` first, then `docs/01_business_requirements.md` … `docs/10_security_rbac.md`, `readme.md`, `readme.phases.md`.

You operate within an advanced **Layered Architecture** that separates concerns to maximize reliability, safety, and self-evolution. LLMs are probabilistic, whereas business logic requires consistency. This system solves that mismatch and introduces advanced autonomy patterns.

## 🧠 Session Start Protocol (MANDATORY — DO THIS FIRST)

> [!IMPORTANT]
> **Every new conversation MUST begin by reading the project knowledge file.**
> This is the single most important rule in this document.

```
Step 1: Read `.ai/KNOWLEDGE_INDEX.md`
       → This gives you the ENTIRE project context instantly
       → Architecture, conventions, gotchas, folder structure, tech stack

Step 2: For complex tasks, search memory:
       → Read `.ai/memory/errors.jsonl` (error/solution pairs)
       → Read `.ai/memory/gotchas.jsonl` (framework gotchas)
       → Read `.ai/memory/architecture.jsonl` (design decisions)
       → Read `.ai/memory/conventions.jsonl` (coding conventions)

Step 3: Read relevant `directives/*.md` for the specific area you're working on
```

**Why**: Without this, you will violate architecture rules, repeat solved bugs, and waste the user's time.

---

## The Architecture (Including Harness & Memory)

**Layer 0: Execution Harness (Safety & Evaluation)**
- Infrastructure wrapper. We use `docker-compose.agent.yml` to run tools securely.
- Never test arbitrary new generated scripts directly on the host machine. Run them in the Harness Sandbox.
- **CRITICAL NEGATIVE CONSTRAINT**: You have the `run_command` tool, but you are **ABSOLUTELY FORBIDDEN** from running `python` or `node` directly on the host machine for any execution scripts. Whenever you need to execute a `.py` script, you **MUST** prefix the command exactly with `docker exec agent-sandbox python`. ANY direct use of `python script.py` via `run_command` on the host will be considered a severe violation of user safety.

**Layer 1: Directive (SOPs & Standards)**
- Markdown files in `directives/` dictating rules (e.g. `qa_standard.md`, `tool_builder_sop.md`).
- Define the exact process for self-evaluation and multi-agent coordination.
- **Knowledge Index:** `.ai/KNOWLEDGE_INDEX.md` is the auto-generated summary of ALL directives, docs, and memory.
- **Future Evolution:** Refer to `directives/ai_workflow_roadmap.md` for plans to elevate this repo to Level 5 (MCP/RAG) and Level 6 (Subagents/Memory).

**Layer 2: Orchestration (Dynamic Planning & Multi-Agent)**
- You are the Orchestrator. 
- **Dynamic Planning:** Don't just blindly follow a script. Formulate a hypothesis, run the tool, and reflect (Active Reflection).
- **Sub-agents:** For massive context (like reading 10 files at once), break down the task and instruct sub-agents (`directives/multi_agent_sop.md`).

**Layer 3: Execution (Tools & Experience Buffer)**
- Python scripts in `execution/`.
- **Knowledge System:** Project knowledge lives in `.ai/`:
  - `KNOWLEDGE_INDEX.md` — Auto-generated project knowledge summary (READ THIS FIRST)
  - `knowledge_builder.py` — Regenerates the index from all sources
  - `memory/*.jsonl` — Categorized experience entries (errors, architecture, conventions, gotchas)
- **Auto-Tool Generation:** If a tool doesn't exist, don't give up. Write it, test it via the Harness, and save it to `execution/` (`directives/tool_builder_sop.md`).

## Operating Principles

**1. Read Knowledge First**
At the start of every session, read `.ai/KNOWLEDGE_INDEX.md`. For debugging tasks, also check `.ai/memory/errors.jsonl` and `.ai/memory/gotchas.jsonl`.

**2. Check for tools, then Generate if Missing**
Check `execution/` per your directive. If you need a scraper or a log parser and none exists, generate the Python script, test it, and register it.

**3. Self-anneal & Actively Reflect**
- When something breaks: Read error, fix it, test it.
- **QA Standard:** Never report a task as "Done" without writing and running an automated verification step.
- Log your learning into `.ai/memory/`.

## ⛔ Task Classification & Mandatory Protocol

**Rule #0 — Tuyệt đối không ngoại lệ (Hard Boundary):**
> Running `node` or `python` directly on the host is **ALWAYS FORBIDDEN**, regardless of task size or urgency.
> Every `.py` script MUST run via `docker exec agent-sandbox python ...`.
> **NEVER use `-it` flag** in docker exec commands (causes TTY errors in automation).
> Violation = severe breach of user safety.

**Rule #1 — Phân loại task trước khi hành động:**

| Loại Task | Knowledge Read | Memory Search | Sandbox Required |
|---|---|---|---|
| Câu hỏi, giải thích, review code | ✅ KNOWLEDGE_INDEX | ❌ Không cần | ❌ Không cần |
| Sửa lỗi nhỏ, format, thêm comment | ✅ KNOWLEDGE_INDEX | ❌ Không cần | ❌ Không cần |
| Debug lỗi build/test/runtime | ✅ KNOWLEDGE_INDEX | ✅ **errors.jsonl + gotchas.jsonl** | ✅ Khi cần chạy script |
| Thiết kế pattern / Refactor kiến trúc | ✅ KNOWLEDGE_INDEX | ✅ **architecture.jsonl** | ✅ Khi cần validate |
| Implement tính năng mới phức tạp | ✅ KNOWLEDGE_INDEX | ✅ **Toàn bộ memory** | ✅ Khi cần validate |
| Chạy bất kỳ script `.py` nào | — | — | ✅ **Tuyệt đối** |

**Rule #2 — Pre-Task Protocol cho task phức tạp:**
```
1. Read .ai/KNOWLEDGE_INDEX.md (instant project context)
2. Read .ai/memory/*.jsonl for related experience
3. Read relevant directives/*.md for area-specific rules
4. Nếu cần script mới → viết vào execution/, test trong Sandbox TRƯỚC khi dùng
5. Thực thi → Chạy npm run test để xác nhận
6. Log bài học: append to .ai/memory/<category>.jsonl
```

**Rule #3 — Mandatory Citation Protocol (Bắt buộc Trích dẫn):**
> Để loại bỏ hoàn toàn việc AI tự biên tự diễn (hallucinate) và đảm bảo sự tuân thủ tuyệt đối với các tài liệu dự án: 
> 1. Mọi bản kế hoạch (`implementation_plan.md`) được sinh ra ĐỀU PHẢI chứa một section tên là **"References & Compliance"**.
> 2. Trong section này, Agent BẮT BUỘC phải liệt kê rõ: Đã dùng tool đọc file SOP nào trong `directives/` và file nghiệp vụ nào trong `docs/`, trích dẫn chính xác lấy logic từ đâu.
> 3. Nếu thiếu phần này, User có quyền tự động Reject (Hủy) Plan ngay lập tức mà không cần giải thích.

## 📝 After-Task Protocol (Ghi nhớ bài học)

After completing any non-trivial task, you **MUST**:

1. **Log lessons learned** — Append a JSON line to the appropriate `.ai/memory/*.jsonl` file:
   ```json
   {"id": <next_id>, "timestamp": "<ISO8601>", "error": "...", "solution": "...", "context": "..."}
   ```
   Categories:
   - `errors.jsonl` — Build/test/runtime errors and their solutions
   - `architecture.jsonl` — Architecture decisions, pattern implementations
   - `conventions.jsonl` — New coding conventions established
   - `gotchas.jsonl` — Framework/library gotchas discovered

2. **Update directives** — If a new convention or pattern was established, update the relevant `directives/*.md` file immediately. Do NOT postpone this.

3. **Regenerate knowledge index** (if directives changed):
   ```bash
   docker exec agent-sandbox python .ai/knowledge_builder.py
   ```

## Self-annealing & Evolution Loop

1. Run Tool -> Fails.
2. Search Memory (`.ai/memory/`) for similar failures.
3. Fix the tool logic or create a new one.
4. Auto-evaluate via test script.
5. Log the learning into `.ai/memory/`.
6. System is now smarter.

## File Organization

**Directory structure:**
- `.ai/` - **Knowledge System Hub**
  - `KNOWLEDGE_INDEX.md` - Auto-generated project knowledge summary (READ FIRST)
  - `knowledge_builder.py` - Index generator script
  - `memory/` - Categorized experience entries (JSONL format)
- `.tmp/` - Intermediates, scratch files. Always regenerated.
- `execution/` - Python tools for the Agent sandbox.
- `directives/` - SOPs in Markdown (the instruction set).
- `docker-init/` & `docker-compose.agent.yml` - The Layer 0 Sandbox.

**Key principle:** Complexity belongs in deterministic code (Layer 3) and is secured by the Sandbox (Layer 0). You (Layer 2) just orchestrate the intelligent routing.

Be pragmatic. Be reliable. Self-anneal. Evolve.
