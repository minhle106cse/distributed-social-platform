// Regenerates typed gRPC contracts from proto/org-provisioning.proto (repo
// root) into src/grpc/. Needs `protoc` on PATH (not bundled — see RUN.md).
// A plain relative --plugin path breaks protoc's plugin invocation on
// Windows, so this resolves everything to absolute paths first.
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkgRoot = join(__dirname, '..')
const repoRoot = join(pkgRoot, '..', '..')

const pluginExt = process.platform === 'win32' ? '.cmd' : ''
const plugin = join(repoRoot, 'node_modules', '.bin', `protoc-gen-ts_proto${pluginExt}`)
const protoFile = join(repoRoot, 'proto', 'org-provisioning.proto')
const protoDir = join(repoRoot, 'proto')
const outDir = join(pkgRoot, 'src', 'grpc')

execFileSync(
  'protoc',
  [
    `--plugin=protoc-gen-ts_proto=${plugin}`,
    `--ts_proto_out=${outDir}`,
    '--ts_proto_opt=outputServices=grpc-js,esModuleInterop=true,useOptionals=messages,env=node',
    `-I${protoDir}`,
    protoFile,
  ],
  { stdio: 'inherit' },
)
