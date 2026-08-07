'use strict'

/**
 * UserPromptSubmit hook — injects TURN-LOCAL STATE into the agent's context.
 *
 * Replaces `doc-select.cjs`, which restated routing rules the agent already has verbatim in
 * CLAUDE.md. Measured 2026-08-07: that reminder fired five turns running without changing the
 * agent's behaviour once (it never did read KNOWLEDGE_INDEX.md) — repeating a static rule the
 * model has already read and already decided about buys nothing, at ~110 tokens every turn.
 *
 * A per-turn hook earns its budget only by carrying what CLAUDE.md CANNOT: state that changes
 * between turns. So this emits working-tree facts and After-Task debt instead of prose.
 *
 * MUST emit hookSpecificOutput.additionalContext — `systemMessage` renders in the user's
 * terminal and never reaches the model (that bug is why the old hook was inert for weeks).
 */

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')

function sh(cmd) {
  try {
    return execSync(cmd, {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

const mtime = (rel) => {
  try {
    return fs.statSync(path.join(ROOT, rel)).mtimeMs
  } catch {
    return 0
  }
}

const lines = []

// ── Working tree ────────────────────────────────────────────────────────────
// The recurring "is this landed or not?" confusion: this repo's work sits across submodules
// and has repeatedly been reasoned about as committed while still dirty. Cheap to state, and
// impossible for a static CLAUDE.md to carry.
// Every apps/* is a git submodule, so root `git status` reports only the submodule POINTER
// (" M apps/core-api") — never the files inside. Descend, or the service code stays invisible.
function submodulePaths() {
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

const branch = sh('git rev-parse --abbrev-ref HEAD')
const rootDirty = (sh('git status --short') || '').split('\n').filter(Boolean)
const subDirty = []
for (const sub of submodulePaths()) {
  if (!fs.existsSync(path.join(ROOT, sub))) continue // not checked out (linked worktree)
  // Only descend into submodules the ROOT status already flags as dirty. Spawning `git status`
  // in all 7 unconditionally cost ~1.5s on every single prompt. Root status reports a submodule
  // with modified OR untracked content under default config, so a clean one has nothing to find.
  if (!rootDirty.some((l) => l.slice(3).trim() === sub)) continue
  const raw = sh(`git -C "${sub}" status --short`)
  for (const l of (raw || '').split('\n').filter(Boolean)) {
    subDirty.push(`${l.slice(0, 3)}${sub}/${l.slice(3).trim()}`)
  }
}
// The submodule pointer lines are noise once their contents are listed explicitly.
const subSet = new Set(submodulePaths())
const dirty = [...rootDirty.filter((l) => !subSet.has(l.slice(3).trim())), ...subDirty]

if (branch) {
  lines.push(
    dirty.length
      ? `git: \`${branch}\`, ${dirty.length} uncommitted path(s) — do NOT assume this work is committed:`
      : `git: \`${branch}\`, working tree clean.`
  )
  for (const line of dirty.slice(0, 10)) lines.push(`  ${line}`)
  if (dirty.length > 10) lines.push(`  …and ${dirty.length - 10} more`)
}

// ── After-Task debt ─────────────────────────────────────────────────────────
// Same check scripts/sync.cjs runs at Stop, surfaced here instead at the START of a turn,
// where it can still be acted on. The Stop-hook copy necessarily arrives after the work is done.
const newestKnowledge = Math.max(
  mtime('.ai/PROJECT_STATUS.md'),
  ...['errors', 'architecture', 'conventions', 'gotchas'].map((c) => mtime(`.ai/memory/${c}.jsonl`))
)
const unlogged = dirty
  .map((l) => l.slice(3).trim())
  .filter((f) => /\/src\/.+\.ts$/.test(f) && !f.endsWith('.spec.ts'))
  .filter((f) => mtime(f) > newestKnowledge)

if (unlogged.length) {
  lines.push(
    `⚠️ After-Task debt: ${unlogged.length} changed source file(s) are newer than the last ` +
      `.ai/memory + PROJECT_STATUS entry. Clear that before piling on more work.`
  )
}

// One line, not the routing table — CLAUDE.md already carries that verbatim, and restating it
// is precisely what made the old hook worthless.
lines.push(
  "Routing: read the area's directives/*.md before writing code; .ai/GOTCHAS.md only when debugging."
)

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: lines.join('\n'),
    },
  })
)
