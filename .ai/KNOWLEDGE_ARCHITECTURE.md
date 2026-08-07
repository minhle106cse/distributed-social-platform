# 🗺️ Knowledge Architecture — how this project remembers things

> The **map** of Cortex's knowledge system. Read this once to understand where every kind of fact
> lives, why, and what keeps the stores honest. `AGENTS.md` is the operating summary; this is the
> rationale behind it. (Restructured 2026-07-21 — see `.ai/CHANGELOG.md`.)

## The problem this solves

Knowledge was drifting because four stores overlapped with no rule for which owned what: the same fact
could land in `docs/`, `directives/`, `.ai/`, or agent memory, and the `docs/` copies rotted because
nothing forced them to track code. The fix is a **single home per fact + forcing-functions + generated
views** so nothing is maintained in two places.

## The two document families (purpose, not audience)

Both agents and humans read both. They split by **what the reader is trying to do**:

| | `docs/` — **Design & Spec** (WHAT & WHY) | `directives/` — **SOP & Rules** (HOW) |
|---|---|---|
| Answers | "What is the system, why, what must it do, how is it run/secured?" | "When I write a file, what rule must I not violate?" |
| Reader intent | Understand / operate / deploy / audit | Execute — write compliant code |
| Style | Complete, narrative, diagrams, rationale, audit trail | Terse, imperative, litmus-driven, lists known exceptions |
| Rots? | Only the 🟩 living-spec subset (schema/API/security/ops) — protected by a forcing-function | No — the agent reads them to write code, so they're touched constantly |
| Index | `docs/README.md` (classifies each doc 🟦/🟩/🟨) | `directives/README.md` (the rulebook index) |

**Litmus:** *"Would a new engineer need this to understand or operate the system?"* → `docs/`.
*"Would an agent about to write a file violate something without this?"* → `directives/`.

## The `.ai/` layer — machine-maintained knowledge

| File | Role | Who writes it |
|---|---|---|
| `KNOWLEDGE_INDEX.md` | The session-start read, **~8k tokens**. 6 sections. **Generated — never hand-edit.** | `knowledge_builder.py` (via the Stop hook) |
| `GOTCHAS.md` | The **on-demand** lesson buffer, ~21k tokens, newest first. Read when debugging; skipped otherwise. **Generated.** | `knowledge_builder.py` (same run) |
| `PROJECT_STATUS.md` | Live status (phase %, focus, live debts). Injected as §2. | Curated by hand, After-Task |
| `CHANGELOG.md` | The historical task journal. **Not scanned** — kept out of the index. | Appended by hand when a durable record is wanted |
| `memory/*.jsonl` | Experience buffer: `errors` / `gotchas` / `architecture` / `conventions`. Local, gitignored. Surfaced as §4. | Appended by hand, After-Task |
| `knowledge_builder.py` | The generator. Scans directives + docs + memory + `apps/*/src/modules` + curated files. | — |
| `KNOWLEDGE_ARCHITECTURE.md` | This map. | By hand, rarely |

The index is a **view**, not a source. §2 = `PROJECT_STATUS.md`, §3 = directive headings, §4 = a
*pointer* to `GOTCHAS.md`, §5 = `docs/` list, §6 = the operating protocol digest. To change the
index, change the source; the Stop hook regenerates it.

> **Why §4 is only a pointer (2026-08-07).** Measured, the index was ~21k tokens and §4 alone was
> **63% of it** — read at *every* session start, including questions and typo fixes where a
> "have I hit this before?" lookup buys nothing. Splitting it into `GOTCHAS.md` cut the mandatory
> read to ~8k with no loss: §4's bodies were clipped anyway, so anything genuinely needed still
> meant grepping the JSONL. `GOTCHAS.md` **is committed** even though `.ai/memory/*.jsonl` is
> gitignored — so the lessons survive a machine change, which the raw buffer alone would not. §2 also appends an **auto-detected module map** (scanned
from the filesystem every run) — if it disagrees with the curated status, the curated file is stale.

> **A digest file (`QUICK_REFERENCE.md`) used to exist** — a hand-maintained summary of directive
> rules, injected as its own section. Removed 2026-07-21: it was a second source of truth for rules
> that already live in `directives/`, and it drifted (exactly the class of bug this project's own
> `config.get() ?? default` sweep caught in code — see `.ai/CHANGELOG.md` 2026-07-04). §3's directive
> headings are the navigation now; the rule text lives in exactly one place.

## Agent memory (`~/.claude/.../memory/`) — the working relationship

Holds **who the user is, how they want me to work, and cross-session working-state** (roadmap /
learning-curriculum progress). **Never** project facts that belong in the repo. Governed by
`directives/memory_sop.md` and the project's own memory guidance.

## The one routing rule — where does a fact go?

| The fact is… | Home |
|---|---|
| An enforceable coding rule / convention / pattern | `directives/*.md` |
| Design / spec / business intent (schema, API, security, ops, why) | `docs/*.md` |
| Where the project is now (phase %, focus, live debts) | `.ai/PROJECT_STATUS.md` (history → `.ai/CHANGELOG.md`) |
| Ephemeral experience (error→fix, gotcha, decision rationale) | `.ai/memory/*.jsonl` |
| Who the user is / how they want me to work | agent memory |

Everything else *points* to the home; it does not copy.

## What keeps the stores honest (forcing-functions)

1. **Docs sync-trigger** — a task that changes schema / API / security / ops MUST reconcile the
   matching 🟩 living-spec `docs/NN_*.md` in the **same task** (`AGENTS.md` After-Task Protocol,
   restated in `qa_standard.md` and `docs/README.md`). This is the discipline that stopped docs rotting.
2. **The `Stop` hook** (`scripts/sync.cjs`) — regenerates the index + `GOTCHAS.md`, rebuilds
   shared-kernel / runs `prisma generate` when relevant, and **blocks the turn from ending**
   (`decision: "block"`) when source files changed with no newer `.ai/memory` / `PROJECT_STATUS`
   entry. This is the **only** part of the After-Task Protocol that is enforced rather than merely
   requested; everything else in `AGENTS.md` is prose the agent can silently skip.
   > Two things had to be fixed before it worked at all (2026-08-07): it emitted `systemMessage`,
   > so a warning addressed to the *agent* was delivered to the *user*; and it filtered root
   > `git status` by `^(apps|packages)/…`, but every `apps/*` is a **submodule** whose root status
   > shows only the pointer — so it was structurally blind to every service's source. It now
   > descends into each submodule, and blocks at most **once per code state**
   > (guard file `.ai/.after-task-guard`) so a refusal can't loop forever.
3. **The `UserPromptSubmit` hook** (`.claude/hooks/turn-context.cjs`) — injects **turn-local state**
   into the agent's context: branch, uncommitted paths (descending into the `apps/*` submodules),
   outstanding After-Task debt, plus a one-line pointer at `directives/README.md`.
   > **Why state, not prose (2026-08-07).** Its predecessor `doc-select.cjs` restated routing rules
   > the agent already has verbatim in `CLAUDE.md`. Once its delivery bug was fixed, it fired five
   > turns running and changed the agent's behaviour zero times — the model had already read the
   > rule and already decided. A per-turn hook only earns its ~130 tokens by carrying what a static
   > `CLAUDE.md` **cannot**: things that differ between turns.
   > **Hook output rule (learned the hard way, 2026-08-07):** a hook meant to steer the *agent* must
   > emit `hookSpecificOutput.additionalContext` (or plain stdout) — valid for `UserPromptSubmit` /
   > `SessionStart`. **`systemMessage` renders in the user's terminal and never reaches the model.**
   > This hook used `systemMessage` from 2026-07-21 to 2026-08-07, so it reminded the human, not the
   > agent, while looking like it worked. `sync.cjs` keeps `systemMessage` on purpose: its build
   > summary and After-Task warning are for the user, and a `Stop` hook can't inject context anyway.
4. **The auto-detected module map** in §2 — makes a lying curated status visible immediately.
5. **Citation Protocol** (`AGENTS.md`) — plans must cite which directives/docs they used.

## Entry points — what to read when

- **Every session:** `.ai/KNOWLEDGE_INDEX.md` (whole context).
- **Before writing code in an area:** the relevant `directives/*.md` — see `directives/README.md`'s
  index (the `turn-context` hook points you there each turn).
- **Need business/design context:** the relevant `docs/NN_*.md` (`docs/README.md` indexes them).
- **Debugging:** `.ai/memory/errors.jsonl` + `gotchas.jsonl`.
- **Instruction set:** `AGENTS.md` (canonical) / `CLAUDE.md` (pointer).
- **How this was built / scaffolding a new repo:** `SETUP.md`.

## Not built (deliberately) — possible future

The AI workflow is intentionally lightweight: Markdown + two hooks + a Python generator, no framework.
Genuinely useful next steps *if a real need appears* (don't build speculatively): a read-only MCP
server over the Prisma schema so the agent can query structure directly; embedding the codebase for
retrieval when the repo outgrows a single index read. The previous "Level 5/6 / LangGraph / CrewAI /
agent-sandbox" roadmap was removed on 2026-07-21 as aspirational scaffolding that never matched how the
project actually works.
