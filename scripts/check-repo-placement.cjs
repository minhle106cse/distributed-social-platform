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

// ── H. shared-kernel stays free of transport + framework RUNTIME dependencies ───────────────
// What is actually true here (measured 2026-08-24, after a first draft of this check asserted
// something stronger and was proved wrong by its own probe):
//   - kafkajs is NEVER imported: `MinimalConsumer`/`MinimalProducer` mirror its API
//     structurally so every service owns its own Kafka client. Stated intent in
//     messaging/index.ts, and it holds.
//   - NO framework/ORM binding (@nestjs, fastify, prisma, ioredis) anywhere.
//   - @grpc/grpc-js IS a runtime dependency, but confined to `src/grpc/**`, which is
//     `npm run proto:gen` OUTPUT — ts-proto emits `makeGenericClientConstructor`, so the
//     generated stubs necessarily import it. Hand-written shared-kernel code must not.
// `import type` is erased at compile time and never counts.
const RUNTIME_BANNED = ['kafkajs', '@nestjs/', 'fastify', '@prisma/', 'ioredis']
const GRPC_RUNTIME_OK = (rel) => rel.startsWith('packages/shared-kernel/src/grpc/')

function checkSharedKernelPurity() {
  const skSrc = path.join(ROOT, 'packages', 'shared-kernel', 'src')
  if (!fs.existsSync(skSrc)) return
  for (const file of walk(skSrc)) {
    if (file.endsWith('.spec.ts')) continue
    const src = fs.readFileSync(file, 'utf8')
    // Only a VALUE import pulls the package in at runtime; `import type` is erased.
    const re = /^\s*import\s+(?!type\b)([\s\S]*?)from\s+['"]([^'"]+)['"]/gm
    let m
    while ((m = re.exec(src))) {
      const spec = m[2]
      const clause = m[1]
      const banned =
        RUNTIME_BANNED.some((b) => spec === b || spec.startsWith(b)) ||
        (spec.startsWith('@grpc/grpc-js') && !GRPC_RUNTIME_OK(rel(file)))
      if (!banned) continue
      // `import { type X, type Y }` is also fully erased.
      const named = clause.match(/\{([\s\S]*)\}/)
      if (named && named[1].split(',').every((s) => !s.trim() || /^\s*type\s/.test(s))) continue
      errors.push(
        `${rel(file)}\n    runtime-imports '${spec}' — shared-kernel must never own a live\n` +
          `    connection or a framework binding, only describe one ('import type' is fine).\n` +
          `    Keep the adapter in the service; put only the contract/algorithm here\n` +
          `    (folder_structure_sop.md § Where an abstraction lives).`,
      )
    }
  }
}

checkSharedKernelPurity()

// ── G. modules/<x>/infrastructure/ has a CLOSED list of subfolders ──────────────────────────
// Checked over directories, not files, so it runs once per service rather than per-file.
// `consumers/` is on the list deliberately (a Kafka consumer is bound to one module's event
// handlers, owner-approved 2026-07-02) — everything else, in particular a transport endpoint,
// belongs to the service-wide `src/infrastructure/<transport>/`. Found 2026-08-24: search-service
// had its RagQuery gRPC SERVER in `modules/search/infrastructure/grpc/` while its gRPC CLIENT sat
// in `src/infrastructure/grpc/` (one transport, two homes, with `bootstrap/` reaching into a
// module), and auth-service had `mapper/` (singular) in 3 modules plus a `jobs/` folder.
const MODULE_INFRA_DIRS = ['mappers', 'consumers', 'services', 'repositories']

function checkModuleInfraDirs(svc) {
  const modulesDir = path.join(ROOT, 'apps', svc, 'src', 'modules')
  if (!fs.existsSync(modulesDir)) return
  for (const mod of fs.readdirSync(modulesDir, { withFileTypes: true })) {
    if (!mod.isDirectory()) continue
    const infra = path.join(modulesDir, mod.name, 'infrastructure')
    if (!fs.existsSync(infra)) continue
    for (const e of fs.readdirSync(infra, { withFileTypes: true })) {
      if (!e.isDirectory() || MODULE_INFRA_DIRS.includes(e.name)) continue
      errors.push(
        `${rel(path.join(infra, e.name))}\n` +
          `    '${e.name}/' is not one of the allowed module-infrastructure folders\n` +
          `    (${MODULE_INFRA_DIRS.join(', ')} — exact names, folder_structure_sop.md canonical tree).\n` +
          `    A transport endpoint (gRPC server/client, HTTP client) belongs in the service-wide\n` +
          `    src/infrastructure/<transport>/ next to the other half of the same transport; a\n` +
          `    module-scoped scheduled job belongs in services/ (cf. ExpiredReservationSweeperService).`,
      )
    }
  }
}

/**
 * Does this service's own eslint config ban `@/common/**` from its domain layer?
 * Read rather than assumed, because the services legitimately differ — see the
 * domain->common branch of check D for why auth-service allows what core-api forbids.
 */
function domainBansCommon(svc) {
  const cfg = path.join(ROOT, 'apps', svc, 'eslint.config.mjs')
  if (!fs.existsSync(cfg)) return false
  const src = fs.readFileSync(cfg, 'utf8')
  const i = src.indexOf("files: ['src/modules/*/domain/**/*.ts']")
  if (i === -1) return false
  const block = src.slice(i, i + 2000)
  const end = block.indexOf('\n  },')
  return /'@\/common\/\*\*'/.test(end === -1 ? block : block.slice(0, end))
}

for (const svc of SERVICES) {
  const src = path.join(ROOT, 'apps', svc, 'src')
  const files = walk(src)
  const bansCommon = domainBansCommon(svc)
  checkModuleInfraDirs(svc)

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

    // ── D. domain must never import application OR common (any form, incl. relative) ───────
    // This is the dependency-direction litmus test with teeth. eslint only blocks the
    // '@/modules/*/application/**' / '@/common/**' ALIAS forms; a relative
    // '../../application/x' or '../../../../common/errors/x' slips straight past it, because
    // no-restricted-imports matches the literal specifier string.
    //
    // `common/` was added here 2026-08-24 after the hole was demonstrated, not assumed: moving
    // credit's errors to common/ and importing them as '@/common/errors/credit.error' was
    // correctly rejected by eslint — then rewriting the SAME import as a relative path passed
    // eslint AND this script. The escape hatch existed for every domain file, not just that one.
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
        // domain -> common/ is enforced ONLY for services that declare the ban themselves
        // (see domainBansCommon). The two services genuinely differ, on purpose:
        //   - core-api bans it  ("chỉ shared-kernel + relative cùng domain")
        //   - auth-service allows it ("chỉ shared-kernel + common/ + relative") — and it is
        //     FORCED to: `auth.error` is thrown by BOTH modules/auth/domain and
        //     modules/user/domain, and a cross-module domain import is banned too, so
        //     common/errors/ is the only home reachable from both.
        // What this closes is not the difference, it is the ESCAPE: in a service that bans it,
        // '@/common/x' is caught by eslint but '../../../../common/x' was not (literal-specifier
        // matching), so the ban could be walked around silently. Demonstrated 2026-08-24.
        if (bansCommon) {
          const isCommon = /(^|\/)src\/common\//.test(resolved) || /^@\/common(\/|$)/.test(spec)
          if (isCommon) {
            errors.push(
              `${r}\n    imports '${spec}' — this service's domain layer bans '@/common/**'\n` +
                `    (its own eslint.config.mjs says so), and that ban covers RELATIVE paths too.\n` +
                `    An error class thrown by a domain class therefore cannot live in\n` +
                `    common/errors/ here — it belongs in modules/<module>/domain/<module>.error.ts\n` +
                `    (naming_conventions.md §6).`,
            )
          }
        }
      }
    }

    // ── F. no PORT may be declared inside infrastructure/ ─────────────────────────────────
    // A port is an inward-pointing abstraction: something outside infrastructure depends on
    // it and infrastructure implements it. Declaring one INSIDE infrastructure either points
    // the dependency arrow backwards (application/common importing @/infrastructure — how
    // IOutboxAppender ended up needing a lint exception) or is infra-calling-infra through a
    // layer of indirection (what IIdempotencyRepository was reverted for, and what
    // IOutboxDispatchRepository/ISagaCompensationDispatchRepository were removed for on
    // 2026-08-24). Two deterministic signals, both structural, neither a guess:
    //   1. an `I<Name>` interface declared in infra AND `implements`ed anywhere in the service
    //   2. an infra file declaring an `I<Name>` interface together with a DI Symbol token
    // Plain data shapes (OutboxAppendInput, JwtPayload, ClaimedOutboxEvent…) are untouched —
    // the rule is about port-ifying BEHAVIOUR, not about declaring types.
    if (r.includes('/infrastructure/') && !base.endsWith('.spec.ts')) {
      const src_ = fs.readFileSync(file, 'utf8')
      const declared = [...src_.matchAll(/^export\s+(?:interface|type)\s+(I[A-Z]\w*)/gm)].map(
        (m) => m[1],
      )
      if (declared.length) {
        const hasToken = /^export const \w+ = Symbol\(/m.test(src_)
        for (const name of declared) {
          const implemented = files.some((f) =>
            new RegExp(`implements[^{]*\\b${name}\\b`).test(fs.readFileSync(f, 'utf8')),
          )
          if (implemented || hasToken) {
            errors.push(
              `${r}\n    declares the port '${name}' inside infrastructure/.\n` +
                `    If a consumer OUTSIDE infrastructure needs it, move the interface to the\n` +
                `    module's domain/ (or common/ when it spans modules) and leave the class here.\n` +
                `    If every consumer is also infrastructure, delete the interface + DI token and\n` +
                `    inject the class directly (resilience_patterns.md §6.1).`,
            )
          }
        }
      }
    }

    // ── I. concrete error files: ONE per module, in that module's own domain/ ─────────────
    // `modules/<module>/domain/<module>.error.ts` — singular filename, single home, no exception.
    //
    // Collapsed there 2026-08-24 (owner: "quy về 1 mối, mỗi module 1 file lỗi"): 8 files moved out
    // of the various `common/errors/` folders and all four services' domain layers now ban
    // `@/common/**` alike, so there is no second legal location left to choose between.
    //
    // The history is the reason this check exists. `naming_conventions.md` §6 used to mandate
    // `common/errors/` for EVERY error while listing the one file that could not obey it
    // (`credit.errors.ts`, thrown by an aggregate) as "sloppiness, not yet fixed". It was never
    // sloppiness — it was two rules contradicting each other, with nothing checking either half.
    if (/\.errors?\.ts$/.test(base) && !base.includes('-error') && !base.endsWith('.spec.ts')) {
      if (base.endsWith('.errors.ts')) {
        errors.push(
          `${r}\n    error file must be SINGULAR: '${base.replace('.errors.ts', '.error.ts')}'\n` +
            `    (naming_conventions.md §6).`,
        )
      }
      const m = r.match(/\/modules\/([^/]+)\/domain\/([^/]+)$/)
      if (!m) {
        errors.push(
          `${r}\n    an error file lives in exactly ONE place (naming_conventions.md §6):\n` +
            `      modules/<module>/domain/<module>.error.ts\n` +
            `    common/errors/ is not an option — every service's domain layer bans\n` +
            `    '@/common/**', so an error thrown by an aggregate could not be imported there.`,
        )
      } else if (m[2] !== `${m[1]}.error.ts`) {
        errors.push(
          `${r}\n    error file must be named after its module: '${m[1]}.error.ts'\n` +
            `    (one error file per module — naming_conventions.md §6).`,
        )
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
