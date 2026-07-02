#!/usr/bin/env node
/**
 * One command to run the whole backend on the host (dev mode).
 *   1) npm run infra:up      (postgres, kafka, elasticsearch, ollama, gateway…)
 *   2) npm run dev:stack     (this script — starts all HTTP services with hot-reload)
 *
 * The API gateway (nginx, :8000) proxies to these host ports, so hit everything
 * through http://localhost:8000/api/v1/*. Each service keeps its own dev script
 * (auth uses `dev`, the NestJS services use `start:dev`) — we just fan them out
 * with prefixed logs. Ctrl+C stops them all.
 */
const { spawn } = require('child_process')

const SERVICES = [
  { name: 'auth   ', dir: 'apps/auth-service', script: 'dev', port: 4001 },
  { name: 'core   ', dir: 'apps/core-api', script: 'start:dev', port: 4002 },
  { name: 'notif  ', dir: 'apps/notification-service', script: 'start:dev', port: 4003 },
  { name: 'search ', dir: 'apps/search-service', script: 'start:dev', port: 4004 },
]

const children = []

function start({ name, dir, script, port }) {
  const child = spawn('npm', ['run', script], { cwd: dir, shell: true })
  const prefix = (line) => `[${name} :${port}] ${line}`
  const pipe = (stream, out) => {
    let buf = ''
    stream.on('data', (d) => {
      buf += d.toString()
      const lines = buf.split('\n')
      buf = lines.pop()
      for (const l of lines) out.write(prefix(l) + '\n')
    })
  }
  pipe(child.stdout, process.stdout)
  pipe(child.stderr, process.stderr)
  child.on('exit', (code) => process.stdout.write(prefix(`exited (${code})`) + '\n'))
  children.push(child)
}

console.log('Starting backend stack — gateway at http://localhost:8000/api/v1/*\n')
SERVICES.forEach(start)

function shutdown() {
  console.log('\nStopping stack…')
  for (const c of children) c.kill('SIGTERM')
  setTimeout(() => process.exit(0), 1500)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
