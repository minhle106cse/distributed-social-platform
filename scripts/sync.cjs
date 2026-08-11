#!/usr/bin/env node
/**
 * scripts/sync.cjs — Project sync script
 *
 * Detects what changed (via git status) and only runs what's needed:
 *   shared-kernel/src/** → turbo build (shared-kernel)
 *   apps/*\/prisma/**    → turbo db:generate
 *   directives/** | docs/** | .ai/memory/** | .ai/PROJECT_STATUS.md → knowledge_builder.py
 *
 * Also emits warn-only checks (never blocks):
 *   - After-Task discipline: code changed but no newer .ai/memory or PROJECT_STATUS entry
 *   - Worktree topology: running in a linked worktree (work may be in the main checkout)
 *
 * Usage:
 *   node scripts/sync.cjs          # smart mode (detects changes)
 *   node scripts/sync.cjs --all    # force run everything
 *   node scripts/sync.cjs --check  # dry-run, print what would run
 *
 * Called automatically by .claude/settings.json Stop hook after every agent response.
 * Also available as: npm run sync
 */

'use strict'

const { execSync } = require('child_process')
const { existsSync } = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const FORCE_ALL = process.argv.includes('--all')
const DRY_RUN = process.argv.includes('--check')

// ─── Detect changed files ────────────────────────────────────────────────────

function getChangedFiles() {
  try {
    return execSync('git status --short --porcelain', {
      cwd: ROOT,
      encoding: 'utf-8',
    })
  } catch {
    return ''
  }
}

const changedRaw = FORCE_ALL ? 'FORCE' : getChangedFiles()

function touched(pattern) {
  if (FORCE_ALL) return true
  return changedRaw.includes(pattern)
}

// ─── Task definitions ────────────────────────────────────────────────────────

const tasks = []

if (touched('packages/shared-kernel/src')) {
  tasks.push({
    id: 'shared-kernel:build',
    label: 'Build shared-kernel (tsc)',
    cmd: 'npx turbo run build --filter=@distributed-social-platform/shared-kernel',
  })
}

if (touched('prisma/')) {
  tasks.push({
    id: 'db:generate',
    label: 'Prisma generate (all services)',
    cmd: 'npx turbo run db:generate',
  })
}

// `.ai/memory/*.jsonl` is gitignored, so `git status --porcelain` can NEVER report it — the
// touched('.ai/memory/') check that used to sit in the condition below was dead from the day
// it was written, and §4 only refreshed when directives/docs/status happened to change too.
// Compare mtimes against the generated index instead: newer memory ⇒ §4 is stale. (2026-08-07)
function memoryNewerThanIndex() {
  const fs = require('fs')
  const mtime = (rel) => {
    try { return fs.statSync(path.join(ROOT, rel)).mtimeMs } catch { return 0 }
  }
  const indexMtime = mtime('.ai/KNOWLEDGE_INDEX.md')
  if (!indexMtime) return true // no index yet → build it
  try {
    return fs
      .readdirSync(path.join(ROOT, '.ai/memory'))
      .filter((f) => f.endsWith('.jsonl'))
      .some((f) => mtime(path.join('.ai/memory', f)) > indexMtime)
  } catch {
    return false // no memory dir → nothing to rebuild for
  }
}

if (
  touched('directives/') ||
  touched('docs/') ||
  touched('.ai/PROJECT_STATUS') ||
  memoryNewerThanIndex()
) {
  const pythonCmd = (() => {
    for (const py of ['python', 'python3', 'py']) {
      try {
        execSync(`${py} --version`, { stdio: 'ignore' })
        return py
      } catch {}
    }
    return null
  })()

  if (pythonCmd) {
    tasks.push({
      id: 'knowledge:build',
      label: 'Regenerate KNOWLEDGE_INDEX.md',
      cmd: `${pythonCmd} .ai/knowledge_builder.py`,
    })
  } else {
    log('⚠️  Python not found — skipping knowledge_builder.py')
  }
}

// ─── Changed source files, INCLUDING inside submodules ───────────────────────
// Every apps/* is a git submodule, so the root `git status --short` reports only the submodule
// POINTER (" M apps/core-api") and never the .ts files inside it. The old discipline check
// filtered root status by /^(apps|packages)\/[^/]+\/src\/.+\.ts$/ and therefore could only ever
// match packages/* — it was structurally blind to every service's source, i.e. to almost all the
// code in this project. Descend into each submodule explicitly. (Found + fixed 2026-08-07.)
function capture(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return ''
  }
}

function listSubmodules() {
  const fs = require('fs')
  try {
    return fs
      .readFileSync(path.join(ROOT, '.gitmodules'), 'utf-8')
      .split('\n')
      .map((l) => l.match(/^\s*path\s*=\s*(.+?)\s*$/))
      .filter(Boolean)
      .map((m) => m[1])
  } catch {
    return []
  }
}

function changedSourceFiles() {
  const out = []
  const collect = (raw, prefix) => {
    String(raw)
      .split('\n')
      .forEach((line) => {
        const rel = line.slice(3).trim()
        if (!rel) return
        const full = prefix ? `${prefix}/${rel}` : rel
        if (/\/src\/.+\.ts$/.test(full) && !full.endsWith('.spec.ts')) out.push(full)
      })
  }
  collect(changedRaw, '')
  for (const sub of listSubmodules()) {
    if (!existsSync(path.join(ROOT, sub))) continue // not checked out (linked worktree)
    // Skip submodules the root status doesn't already flag — descending into all 7 on every
    // Stop cost ~1s for nothing. Root status reports a submodule with modified OR untracked
    // content under default config, so a clean one has nothing to contribute.
    if (!String(changedRaw).includes(sub)) continue
    collect(capture('git status --short --porcelain', path.join(ROOT, sub)), sub)
  }
  return out
}

// ─── Discipline & topology checks ────────────────────────────────────────────
// Surface omissions the way §2 auto-detect does: machine-detected, visible —
// not a reminder the agent can silently skip.
const warnings = []

// (B) Linked-worktree topology: this hook runs against the CURRENT tree. If the
//     session sits in a git worktree but work happened in the main checkout, the
//     sync here is misleading. Warn loudly instead of silently no-op'ing.
;(function checkWorktree() {
  try {
    const gitDir = execSync('git rev-parse --git-dir', { cwd: ROOT, encoding: 'utf-8' }).trim()
    const commonDir = execSync('git rev-parse --git-common-dir', { cwd: ROOT, encoding: 'utf-8' }).trim()
    if (path.resolve(ROOT, gitDir) !== path.resolve(ROOT, commonDir)) {
      const mainRoot = path.dirname(path.resolve(ROOT, commonDir))
      warnings.push(
        '⚠️  Linked git worktree detected — this sync ran against the worktree, not the ' +
          `main checkout (${mainRoot}). If you edited main, its changes were NOT synced: ` +
          'run `npm run sync` there, or work in main (submodules are not checked out in worktrees).'
      )
    }
  } catch {}
})()

// (A2) CLAUDE.md/AGENTS.md drift: Claude Code auto-loads ONLY CLAUDE.md at session start (verified
//     2026-08-11 — the very first system-reminder of a session contains CLAUDE.md's content, never
//     AGENTS.md's), so CLAUDE.md duplicates AGENTS.md's decision-relevant sections in full rather
//     than linking to them. That duplication drifts silently the moment someone edits one file and
//     not the other — same failure class as the .ai/PROJECT_STATUS.md staleness found the same day.
//     Warn-only (not blocking): plenty of AGENTS.md edits are to sections CLAUDE.md never mirrors
//     (hook internals, the docs/directives litmus table), so touching AGENTS.md alone is often
//     correct — this is a nudge to check, not a rule that both must always change together.
;(function checkClaudeAgentsDrift() {
  if (touched('AGENTS.md') && !touched('CLAUDE.md')) {
    warnings.push(
      '⚠️  AGENTS.md changed without CLAUDE.md — if the edit touched Session Start Protocol, ' +
        'Task Classification, Citation Protocol, or Hard Rules (the sections CLAUDE.md duplicates ' +
        'in full because Claude Code never auto-reads AGENTS.md), port it to CLAUDE.md now.'
    )
  }
})()

// (A) After-Task discipline: code changed but knowledge not logged. Memory is
//     gitignored so git can't see it → compare mtimes (newest code vs newest
//     memory/status). Heuristic, deterministic.
//
//     This is addressed to the AGENT ("log the lesson before finishing"), so it does NOT go out
//     as `systemMessage` — that field only renders in the user's terminal. It returns a
//     `decision: "block"` + `reason`, which stops the turn ending and feeds the reason back to
//     the model. Nothing else in this project makes After-Task more than an honour system:
//     AGENTS.md is prose the agent may silently skip, and until 2026-08-07 this very warning was
//     shouting at the wrong party.
let afterTaskBlock = null

;(function checkDiscipline() {
  if (FORCE_ALL) return
  const fs = require('fs')
  const codeFiles = changedSourceFiles()
  if (codeFiles.length === 0) return

  const mtime = (rel) => {
    try { return fs.statSync(path.join(ROOT, rel)).mtimeMs } catch { return 0 }
  }
  const newestCode = Math.max(...codeFiles.map(mtime))
  // Split on purpose: a memory .jsonl entry is what AGENTS.md step 1 actually requires (mandatory,
  // every task). PROJECT_STATUS.md is step 4 — conditional, only when a phase/module changed — so
  // it must never be sufficient on its own. Before this split, touching ONLY PROJECT_STATUS.md
  // (no .jsonl entry) satisfied the whole check; found 2026-08-11 by cross-checking PROJECT_STATUS
  // prose against `git log` and finding a week of stale "uncommitted" claims for already-landed
  // work whose lessons WERE logged — i.e. the check was passing on the wrong signal.
  const memoryFiles = [
    '.ai/memory/errors.jsonl',
    '.ai/memory/architecture.jsonl',
    '.ai/memory/conventions.jsonl',
    '.ai/memory/gotchas.jsonl',
  ]
  const newestMemory = Math.max(0, ...memoryFiles.map(mtime))
  if (newestCode <= newestMemory) return

  // Loop guard. Blocking a Stop hook makes the agent continue, which fires Stop again — an
  // unguarded block never terminates. `stop_hook_active` is NOT in the public hook docs, so
  // rather than depend on an unverified field this keys off the code state itself: block at most
  // ONCE per (newest code mtime + file count). If the agent logs the lesson, the key changes and
  // the check passes; if it deliberately declines, the key is unchanged and the turn ends.
  const guardFile = path.join(ROOT, '.ai/.after-task-guard')
  const key = `${newestCode}:${codeFiles.length}`
  let alreadyBlocked = false
  try { alreadyBlocked = fs.readFileSync(guardFile, 'utf-8').trim() === key } catch {}

  if (alreadyBlocked) {
    warnings.push(
      `⚠️  After-Task still unlogged for ${codeFiles.length} code file(s) — already prompted ` +
        'once for this change; not blocking again.'
    )
    return
  }

  try { fs.writeFileSync(guardFile, key) } catch {}
  afterTaskBlock =
    `After-Task Protocol not run: ${codeFiles.length} source file(s) changed ` +
    `(${codeFiles.slice(0, 5).join(', ')}${codeFiles.length > 5 ? ', …' : ''}) but nothing newer ` +
    'exists in .ai/memory/*.jsonl. (Touching only .ai/PROJECT_STATUS.md does NOT clear this — a ' +
    'memory entry is the mandatory step, PROJECT_STATUS is conditional on top of it.)\n\n' +
    'Before finishing: (1) append the lesson/decision to the right .ai/memory/<category>.jsonl ' +
    '(canonical shape in directives/memory_sop.md); (2) if a rule was established or refined, ' +
    'edit the relevant directives/*.md now; (3) if the change touches schema, API contract, ' +
    'security/RBAC or ops, reconcile the matching docs/NN_*.md in THIS task; (4) update ' +
    '.ai/PROJECT_STATUS.md if a phase/module changed.\n\n' +
    'If this genuinely warrants no entry (pure formatting, a revert), say so explicitly and stop.'
})()

// ─── Execution ───────────────────────────────────────────────────────────────

function log(msg) {
  process.stderr.write(msg + '\n')
}

function run(cmd) {
  try {
    execSync(cmd, {
      cwd: ROOT,
      stdio: ['ignore', process.stderr, process.stderr],
    })
    return true
  } catch {
    return false
  }
}

// Two audiences, two channels — conflating them is what made the After-Task check inert:
//   systemMessage      → the USER's terminal (build results, topology warnings)
//   decision + reason  → the AGENT (blocks the turn ending, feeds the reason back)
function emit(systemMessage, blockReason) {
  const out = {}
  if (systemMessage) out.systemMessage = systemMessage
  if (blockReason) {
    out.decision = 'block'
    out.reason = blockReason
  }
  process.stdout.write(JSON.stringify(out))
}

if (tasks.length === 0) {
  // No build tasks — but still surface any discipline/topology warnings.
  const msg = warnings.length
    ? warnings.join('\n\n')
    : '✅ sync: no relevant changes detected.'
  emit(msg, afterTaskBlock)
  process.exit(0)
}

log('\n╔══════════════════════════════════╗')
log('║  🔄  PROJECT SYNC                ║')
log('╚══════════════════════════════════╝')
tasks.forEach((t) => log(`  → ${t.label}`))
log('')

if (DRY_RUN) {
  const cmds = tasks.map((t) => `  [${t.id}] ${t.cmd}`).join('\n')
  process.stdout.write(
    JSON.stringify({ systemMessage: `sync --check: would run:\n${cmds}` })
  )
  process.exit(0)
}

const results = []

for (const task of tasks) {
  log(`▶ ${task.label}`)
  const ok = run(task.cmd)
  const icon = ok ? '✅' : '❌'
  results.push(`${icon} ${task.label}`)
  log(`${icon} done\n`)
}

const allOk = results.every((r) => r.startsWith('✅'))
const summary = `sync:\n${results.join('\n')}` +
  (warnings.length ? `\n\n${warnings.join('\n\n')}` : '')

log('══════════════════════════════════')
log(allOk ? '✅ All synced.' : '❌ Some tasks failed — check output above.')
log('══════════════════════════════════\n')

emit(summary, afterTaskBlock)
// Exit 0 even on task failure: the JSON `decision` above is what steers the agent, and a
// non-zero exit here would be reported as a hook error on top of it, muddying both channels.
process.exit(0)
