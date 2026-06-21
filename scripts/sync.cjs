#!/usr/bin/env node
/**
 * scripts/sync.cjs — Project sync script
 *
 * Detects what changed (via git status) and only runs what's needed:
 *   shared-kernel/src/** → turbo build (shared-kernel)
 *   apps/*\/prisma/**    → turbo db:generate
 *   directives/** | docs/** | .ai/memory/** | .ai/PROJECT_STATUS.md | .ai/QUICK_REFERENCE.md → knowledge_builder.py
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

if (
  touched('directives/') ||
  touched('.ai/memory/') ||
  touched('docs/') ||
  touched('.ai/PROJECT_STATUS') ||
  touched('.ai/QUICK_REFERENCE')
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

// ─── Discipline & topology checks (warn-only, never block) ───────────────────
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

// (A) After-Task discipline: code changed but knowledge not logged. Memory is
//     gitignored so git can't see it → compare mtimes (newest code vs newest
//     memory/status). Heuristic, deterministic, warn-only.
;(function checkDiscipline() {
  if (FORCE_ALL) return
  const fs = require('fs')
  const codeFiles = String(changedRaw)
    .split('\n')
    .map((l) => l.slice(3).trim())
    .filter((f) => /^(apps|packages)\/[^/]+\/src\/.+\.ts$/.test(f) && !f.endsWith('.spec.ts'))
  if (codeFiles.length === 0) return

  const mtime = (rel) => {
    try { return fs.statSync(path.join(ROOT, rel)).mtimeMs } catch { return 0 }
  }
  const newestCode = Math.max(...codeFiles.map(mtime))
  const knowledgeFiles = [
    '.ai/PROJECT_STATUS.md',
    '.ai/memory/errors.jsonl',
    '.ai/memory/architecture.jsonl',
    '.ai/memory/conventions.jsonl',
    '.ai/memory/gotchas.jsonl',
  ]
  const newestKnowledge = Math.max(0, ...knowledgeFiles.map(mtime))

  if (newestCode > newestKnowledge) {
    warnings.push(
      `⚠️  After-Task: ${codeFiles.length} code file(s) changed but no newer entry in ` +
        '.ai/memory/* or .ai/PROJECT_STATUS.md. Log the lesson/decision + update status ' +
        'before finishing (AGENTS.md After-Task Protocol). To enforce hard, flip this check to exit 2.'
    )
  }
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

if (tasks.length === 0) {
  // No build tasks — but still surface any discipline/topology warnings.
  const msg = warnings.length
    ? warnings.join('\n\n')
    : '✅ sync: no relevant changes detected.'
  process.stdout.write(JSON.stringify({ systemMessage: msg }))
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

// Output systemMessage for Stop hook (Claude Code reads this)
process.stdout.write(JSON.stringify({ systemMessage: summary }))
process.exit(allOk ? 0 : 1)
