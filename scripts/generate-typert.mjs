import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { typertPlugin } from '@deepseek-ai/dsh-typert-generator/tsdown'
import { installGeneratedRemoteRuntime } from './generated-remote-runtime.mjs'

await typertPlugin({ mode: 'workspace', faces: ['host'] })
  .writeBundle({ dir: resolve('lib') })

const require = createRequire(resolve('packages/jev/package.json'))
await installGeneratedRemoteRuntime(resolve('packages/jev/lib'), require.resolve('@deepseek-ai/dsh-typert-protocol/remote-info'))
