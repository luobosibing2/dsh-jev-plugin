import { mkdir, readFile, readdir, copyFile, symlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

const reference = resolve('packages/typert-protocol-reference')
const require = createRequire(resolve('packages/jev/package.json'))
const installed = dirname(require.resolve('@deepseek-ai/dsh-typert-protocol/package.json'))
const manifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'))
if (manifest.version !== '0.2.1-alpha.2') {
  throw new Error(`Expected @deepseek-ai/dsh-typert-protocol@0.2.1-alpha.2, found ${manifest.version}`)
}

const declarations = join(installed, 'lib/types')
const output = join(reference, 'src')
await mkdir(output, { recursive: true })
for (const name of await readdir(declarations)) {
  if (name.endsWith('.d.ts')) await copyFile(join(declarations, name), join(output, name))
}
try { await symlink('../jev/node_modules', join(reference, 'node_modules'), 'dir') }
catch (error) { if (error?.code !== 'EEXIST') throw error }
