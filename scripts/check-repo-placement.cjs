#!/usr/bin/env node
/**
 * Mechanical gate for the repository-placement rule (cqrs_pattern.md).
 *
 * WHY THIS EXISTS: the rule used to live only as prose in two directives — and those two
 * directives contradicted each other for ~6 weeks (folder_structure_sop.md's canonical tree
 * said `application/repositories/`, cqrs_pattern.md said that folder was banned) without
 * anything noticing. Prose is not a control. These checks are.
 *
 * Scope note — what a script CAN and CANNOT decide:
 *   - Deterministic, checked here: WHERE a port file sits, and whether domain imports application.
 *   - NOT checked here: whether a given interface "should" be a read or write port. That is a
 *     design judgement (see the 2-step decision rule in cqrs_pattern.md). Deliberately not
 *     guessed at — a heuristic that fires wrongly trains people to ignore the gate.
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const SERVICES = ['core-api', 'auth-service', 'notification-service', 'search-service']
const errors = []

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.ts')) out.push(p)
  }
  return out
}

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/')

for (const svc of SERVICES) {
  const src = path.join(ROOT, 'apps', svc, 'src')
  const files = walk(src)

  for (const file of files) {
    const r = rel(file)
    const base = path.basename(file)

    // ── A. A query-repo port belongs in application/repositories/, nowhere else ────────────
    if (base.endsWith('.query-repository.ts') && !r.includes('/infrastructure/')) {
      if (!r.includes('/application/repositories/')) {
        errors.push(
          `${r}\n    A query-repo PORT must live in <module>/application/repositories/.\n` +
            `    Move it there (cqrs_pattern.md § Repository-interface & DTO placement).`,
        )
      }
    }

    // ── B. domain/repositories/ must not use the query-repository suffix ───────────────────
    if (r.includes('/domain/repositories/') && base.endsWith('.query-repository.ts')) {
      errors.push(
        `${r}\n    '.query-repository.ts' is reserved for application-layer ports.\n` +
          `    A domain read port is 'I{X}Reader' in <name>.repository.ts (naming_conventions.md §4).`,
      )
    }

    // ── C. application/repositories/ holds ONLY ports — keep its meaning single ────────────
    // (a folder with no single meaning is exactly what caused the 2026-07-03 drift)
    if (r.includes('/application/repositories/') && !base.endsWith('.query-repository.ts')) {
      errors.push(
        `${r}\n    application/repositories/ holds ONLY '*.query-repository.ts' port files.\n` +
          `    DTOs go in application/queries/; handlers/use-cases stay in application/queries/.`,
      )
    }

    // ── D. domain must never import application (any form, incl. relative) ─────────────────
    // This is the dependency-direction litmus test with teeth. eslint only blocks the
    // '@/modules/*/application/**' alias form; a relative '../../application/x' slips past it.
    if (r.includes('/domain/') && !base.endsWith('.spec.ts')) {
      const src_ = fs.readFileSync(file, 'utf8')
      const re = /from\s+['"]([^'"]+)['"]/g
      let m
      while ((m = re.exec(src_))) {
        const spec = m[1]
        const resolved = spec.startsWith('.')
          ? rel(path.resolve(path.dirname(file), spec))
          : spec
        if (/(^|\/)application\//.test(resolved) || /@\/modules\/[^/]+\/application\//.test(spec)) {
          errors.push(
            `${r}\n    imports '${spec}' — domain must NEVER import application (Dependency Rule).\n` +
              `    If a domain class needs this port, the port belongs in domain/repositories/ instead.`,
          )
        }
      }
    }

    // ── E. a per-query subfolder holds only its query + handler ───────────────────────────
    const mq = r.match(/\/application\/queries\/([^/]+)\/([^/]+)$/)
    if (mq && !/\.(query|handler)\.ts$/.test(mq[2]) && !mq[2].endsWith('.spec.ts')) {
      errors.push(
        `${r}\n    A per-query folder holds only <name>.query.ts + <name>.handler.ts (+ spec).\n` +
          `    Ports → application/repositories/; response DTOs → application/queries/<module>.dto.ts.`,
      )
    }
  }
}

if (errors.length) {
  console.error(`\n✗ repo-placement: ${errors.length} violation(s)\n`)
  for (const e of errors) console.error('  ' + e + '\n')
  console.error('Decision rule: cqrs_pattern.md § "Repository-interface & DTO placement".\n')
  process.exit(1)
}
console.log('✓ repo-placement: all repository ports correctly placed')
