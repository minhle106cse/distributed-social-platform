# SOP: Knowledge Routing & Agent Memory

> Read at session start and whenever you're about to record a lesson. This directive answers **which
> store owns which fact** — so knowledge stops getting duplicated across four places and drifting.

## 🗺️ The one routing rule (where does this fact go?)

There are distinct knowledge stores. Put each fact in exactly one home; the others should *point*, not
copy. Full rationale + diagram: `.ai/KNOWLEDGE_ARCHITECTURE.md`.

| The fact is… | Home | Not here |
|---|---|---|
| An enforceable **coding rule / convention / pattern** | `directives/*.md` | not memory, not docs |
| **Design / spec / business intent** (what & why, schema, API, security, ops) | `docs/*.md` | not directives |
| **Where the project is now** (phase %, focus, live debts) | `.ai/PROJECT_STATUS.md` (history → `.ai/CHANGELOG.md`) | not the index (it's generated) |
| **Ephemeral experience** — a build error→fix, a library gotcha, a design decision's rationale | `.ai/memory/*.jsonl` | not directives (unless it becomes a rule) |
| **Who the user is + how they want me to work** (prefs, feedback, learning-plan progress) | agent memory (`~/.claude/.../memory/`) | **never** project facts that belong in the repo |

Litmus for the last two rows: *does this fact belong to the project (any engineer would need it) or to
the working relationship (only this agent+user need it)?* Project → repo. Relationship → agent memory.

> `.ai/KNOWLEDGE_INDEX.md` is **generated** from directives + docs + `PROJECT_STATUS` + memory by
> `knowledge_builder.py` (run automatically by the `Stop` hook). **Never hand-edit it** — edit the
> source, the hook regenerates it. §4 "Known Gotchas" is a *view* of `.ai/memory/*.jsonl`, not a
> second copy to maintain. (There used to be a hand-maintained `QUICK_REFERENCE.md` digest injected
> as its own section — removed 2026-07-21 as a second source of truth for rules that already live in
> `directives/`; §3's directive headings are the navigation instead.)

## ⚙️ Session start

1. Read `.ai/KNOWLEDGE_INDEX.md` — whole project context.
2. For complex tasks, search `.ai/memory/*.jsonl` for related experience.
3. Read the relevant `directives/*.md` before writing code (`directives/README.md` indexes them; the
   `doc-select` hook prints a reminder to check it).

## 📖 When to SEARCH `.ai/memory/`

| Task | Read |
|---|---|
| Debug a TS/Prisma/Jest error | `errors.jsonl` + `gotchas.jsonl` |
| Design a pattern (CQRS, repo, middleware) | `architecture.jsonl` |
| Configure infra (Docker, Prisma, JWT) | `gotchas.jsonl` |
| Refactor architecture | `architecture.jsonl` + `conventions.jsonl` |
| Write new code in a module | `conventions.jsonl` |

Search by reading the file or `grep`. The four files are small — reading one fully is cheap.

## 📝 When to LOG to `.ai/memory/` (After-Task Protocol)

Log after solving something non-obvious (anything that took >10 min, a gotcha, a design decision):

- `errors.jsonl` — build/test/runtime error → solution
- `gotchas.jsonl` — framework/library gotcha
- `architecture.jsonl` — architecture decision (reactive **or** proactive "chose A over B")
- `conventions.jsonl` — a new coding convention

Two entry formats:

```json
{"id": 27, "timestamp": "2026-07-21T10:00:00+07:00", "error": "…", "solution": "…", "context": "file/module"}
{"id": 28, "timestamp": "2026-07-21T10:00:00+07:00", "decision": "…", "rationale": "…", "alternatives": "…", "context": "file/module"}
```

**If the lesson is really a durable rule**, don't stop at memory — promote it: add/refine the
`directives/*.md`. Memory is the experience buffer; directives are the law.

## 🔄 The self-annealing loop (do it without being asked)

When a pattern is settled or an architectural boundary is clarified during work, **before reporting
done**:

1. Append the lesson to `.ai/memory/<category>.jsonl` (`decision` format for proactive choices).
2. Update the relevant `directives/*.md` immediately (create one only if a genuinely new area).
3. If the change touches schema / API / security / ops, reconcile the matching `docs/NN_*.md`
   (living-spec forcing-function — see `docs/README.md`).
4. Update `.ai/PROJECT_STATUS.md` if a phase/module changed.

The `Stop` hook then regenerates `KNOWLEDGE_INDEX.md`. To see it immediately: `python .ai/knowledge_builder.py`
(host python — there is no agent sandbox). Memory files are gitignored (local); the index is committed.
