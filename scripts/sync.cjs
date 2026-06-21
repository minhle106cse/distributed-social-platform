#!/usr/bin/env node
/**
 * scripts/sync.cjs — Project sync script
 *
 * Detects what changed (via git status) and only runs what's needed:
 *   shared-kernel/src/** → turbo build (shared-kernel)
 *   apps/*\/prisma/**    → turbo db:generate
 *   directives/** | docs/** | .ai/memory/** | .ai/PROJECT_STATUS.md | .ai/QUICK_REFERENCE.md → knowledge_builder.py
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
  // Nothing to do — output systemMessage for Stop hook
  process.stdout.write(
    JSON.stringify({ systemMessage: '✅ sync: no relevant changes detected.' })
  )
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
const summary = `sync:\n${results.join('\n')}`

log('══════════════════════════════════')
log(allOk ? '✅ All synced.' : '❌ Some tasks failed — check output above.')
log('══════════════════════════════════\n')

// Output systemMessage for Stop hook (Claude Code reads this)
process.stdout.write(JSON.stringify({ systemMessage: summary }))
process.exit(allOk ? 0 : 1)
