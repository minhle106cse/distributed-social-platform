# QA Standard & Active Reflection

> Read before reporting any task "done". **Never** claim completion without an independent
> verification step whose output you actually read.

## Principle 1 — Assume the code is wrong until proven otherwise (Zero Trust)

Whether you added logic in `apps/` or `packages/`, never assume it runs correctly on the first try.

- New logic ships with a unit test.
- A change to an existing business flow re-runs the existing tests (`npm run test`, or the
  per-service test script) — and you read the output, not just the exit code.

## Principle 2 — Active Reflection

Before concluding, run this loop:

1. **Hypothesis** — what does this do? Inputs? Expected output?
2. **Test run** — feed a wrong input to check error handling, then a correct input to see real output.
3. **Reflect** — does the output match the hypothesis? Any warning in the terminal? A **TypeScript or
   lint warning must be fixed now**, not ignored (`npm run check` = `typecheck lint format:check`).

## Principle 3 — Auto-Evaluation for complex work

For a non-trivial task (e.g. building a module), don't stop at unit tests — exercise it end-to-end:

- Call the new endpoint against a live stack (the browser preview, or `curl` through the gateway).
- Query the database to confirm the data was actually written correctly.
- Check relationships/invariants hold.
- For infra containers (Postgres, nginx, Kafka), reach them with `docker exec <container> …`.

Only report Done once this passes. Match the project's existing smoke-test style (craft an RS256 JWT,
seed the DB, inject a byte-faithful CloudEvent, confirm consumer lag = 0 — see `.ai/memory/*.jsonl`).

## Completion workflow

1. Code the feature / fix the bug.
2. Write / update the test case.
3. Run `npm run test` (or the relevant test command). Read the log carefully.
4. FAIL → back to step 1.
5. PASS → if the change is structurally complex, run a live end-to-end verification (Principle 3).
6. When fully confident, run the **After-Task Protocol** (see `AGENTS.md`): log the lesson to
   `.ai/memory/<category>.jsonl`, update the relevant `directives/*.md`, reconcile any affected
   `docs/NN_*.md`, update `.ai/PROJECT_STATUS.md` if a phase/module changed — then report Done.
