'use strict'

// Short reminder, not a routing table — the routing table lives in exactly one place
// (directives/README.md's index) so it can't drift from this hook. Removed 2026-07-21:
// this used to hardcode its own 60-line task→doc map, duplicating directives/README.md
// and .ai/KNOWLEDGE_ARCHITECTURE.md's entry points.
const msg = `
📖 Read .ai/KNOWLEDGE_INDEX.md if not already in context. Before writing code in an area,
check directives/README.md's index for the right directive (need business/design context
instead? see docs/README.md). Complex task → also search .ai/memory/*.jsonl.
`.trim()

process.stdout.write(JSON.stringify({ systemMessage: msg }))
