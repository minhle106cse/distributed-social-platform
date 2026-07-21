# 📚 Docs — Design & Spec (the WHAT & WHY)

**These documents describe what Cortex is, why it exists, what it must do, and how it is run and
secured.** They serve a human engineer designing, operating, deploying, or auditing the system — and
an agent that needs business context. They are the counterpart to `directives/` (the enforced coding
rulebook / the HOW).

Boundary litmus:
- *"Would a new engineer need this to understand or operate the system?"* → **`docs/`** (here)
- *"Would an agent about to write a file violate something without this?"* → **`directives/`**

Full knowledge map (docs vs directives vs `.ai/` vs agent memory): **`.ai/KNOWLEDGE_ARCHITECTURE.md`**.

---

## The three kinds of doc here (and which ones rot)

Not every doc changes at the same rate. Knowing the kind tells you when to touch it:

| Kind | Meaning | Changes when |
|---|---|---|
| 🟦 **Product intent** | Business/UX intent — stable, rarely tracks code | The product decision itself changes |
| 🟩 **Living spec** | Technical spec that MUST track the code | Every task that changes the thing it specifies |
| 🟨 **Review artifact** | Point-in-time finding/audit — historical, not maintained | Never (it's a snapshot; supersede with a new one) |

| Doc | Kind | Sync-trigger (reconcile in the SAME task when…) |
|---|---|---|
| `01_business_requirements.md` | 🟦 Product intent | business scope/pillars change |
| `02_use_cases.md` | 🟦 Product intent | user↔system flows change |
| `03_system_architecture_diagrams.md` | 🟩 Living spec | topology / service boundaries / data flow change |
| `04_database_schema.md` | 🟩 Living spec | **any Prisma schema change** |
| `05_web_ui_ux_guidelines.md` | 🟦 Product intent | UX principles change |
| `06_api_contracts.md` | 🟩 Living spec | **any endpoint / request-response shape change** |
| `07_design_system_assets.md` | 🟦 Product intent | design tokens/components change |
| `08_testing_and_qa_strategy.md` | 🟩 Living spec | the testing strategy changes (the *how* lives in `directives/testing_standard.md`) |
| `09_devops_infrastructure.md` | 🟩 Living spec | **infra / compose / observability posture changes** |
| `10_security_rbac.md` | 🟩 Living spec | **RBAC / auth / tenant-isolation / rate-limit posture changes** |
| `11_auth_service_review.md` | 🟨 Review artifact | (snapshot — don't maintain; write a new review if needed) |
| `linkedin_posts_plan.md` | — Content plan | not a design doc — the LinkedIn narrative backlog |

## The forcing function (why these stopped rotting)

The 🟩 **Living specs** are the ones that used to drift, because nothing forced them to track code. Now
the **After-Task Protocol** (`AGENTS.md`) makes it a rule: *a task that changes schema, an API
contract, security/RBAC, or ops posture MUST reconcile the matching living-spec doc in the same task —
never leave a design doc contradicting the code.* This is the same discipline `directives/` always had.
`qa_standard.md`'s completion workflow and `knowledge_builder.py`'s After-Task digest both restate it.

## i18n — TODO

English translations previously lived under `docs/en/` as an **abandoned partial mirror** (summary
stubs + a landing page stuck on a stale "Phase 0" badge). It was removed on 2026-07-21 because an
unmaintained English mirror misrepresents the project. **TODO:** re-introduce English docs only as a
maintained translation (or flip English to canonical) — see the decision when i18n is prioritized.
