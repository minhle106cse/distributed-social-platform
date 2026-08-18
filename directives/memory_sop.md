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
> source, the hook regenerates it. The same run also generates `.ai/GOTCHAS.md` — a *view* of
> `.ai/memory/*.jsonl`, not a second copy to maintain; index §4 is only a pointer to it. (There used to be a hand-maintained `QUICK_REFERENCE.md` digest injected
> as its own section — removed 2026-07-21 as a second source of truth for rules that already live in
> `directives/`; §3's directive headings are the navigation instead.)

## ⚙️ Session start

1. Read `.ai/KNOWLEDGE_INDEX.md` (~8k tokens) — whole project context.
2. **Debugging only:** read `.ai/GOTCHAS.md` (~21k). `grep .ai/memory/*.jsonl` for full text.
3. Read the relevant `directives/*.md` before writing code (`directives/README.md` indexes them; the
   `turn-context` hook points there each turn).

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

**`errors` vs `gotchas`, concretely** (the two get conflated otherwise — almost every gotcha is
*found* via some error message, so "did an error appear" doesn't distinguish anything):
`errors.jsonl` is for a terse, mechanical **error → solution** pair — one or two sentences, no
root-cause narrative, the kind of thing anyone hitting the identical message can copy-paste and
move on (see `.ai/memory/errors.jsonl` in a repo that has real entries for the shape). `gotchas.jsonl`
is for an entry with an actual **lesson**: root cause explained, why it's non-obvious, how to
recognize/avoid it next time — regardless of whether an error message happened to appear while
finding it. When in doubt: if writing it as one line would lose the reason the entry is worth
having, it's a gotcha, not an error.

**CANONICAL entry format** — one shape for every category (2026-08-07):

```json
{"timestamp": "2026-08-07T10:00:00+07:00", "type": "gotchas", "title": "the one-line lesson", "detail": "what happened, why, how it was fixed / chose A over B because …", "context": "file/module"}
```

`type` = the file's own category (`errors` / `gotchas` / `architecture` / `conventions`). `context` is
optional. For an architecture decision, put the choice in `title` and the rationale + rejected
alternatives in `detail` — no separate `decision`/`rationale`/`alternatives` keys any more.

> **Why one shape:** seven shapes had accumulated across 161 entries, and `knowledge_builder.py`
> rendered only the `error`+`solution` pair — silently dropping **96 of them (60%)**, including every
> `decision`/`rationale` entry, the format this SOP itself used to prescribe. Nothing surfaced it
> because appending a line always appeared to succeed. The builder now normalizes across **all**
> legacy shapes (`title`/`detail`, `decision`/`rationale`/`alternatives`, `convention`/`how`,
> `problem`/`solution`, `symptom`/`root_cause`/`fix`, `summary`/`tag`, `entry`), so **no back-fill or
> migration is needed** — old entries render fine. Use the canonical shape for new ones only.
>
> Entries render into **`.ai/GOTCHAS.md`** (generated, newest first, bodies clipped), *not* into
> `KNOWLEDGE_INDEX.md` — §4 there is just a pointer. Read `GOTCHAS.md` when **debugging**; skip it
> for questions and small fixes. The full text always lives here in the JSONL — `grep` it when a
> headline looks relevant.

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
