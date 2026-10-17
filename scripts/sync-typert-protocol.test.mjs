import { execFile } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, expect, it } from 'vitest'

const execute = promisify(execFile)
const project = fileURLToPath(new URL('..', import.meta.url))
const script = join(project, 'scripts/sync-typert-protocol.mjs')
const artifacts = resolve(project, '.artifacts/protocol-sync-tests')
const roots = []

afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== artifacts || !basename(root).startsWith('checkout-')) throw new Error('Unexpected fixture directory')
    await rm(root, { recursive: true, force: true })
  }
})

async function fixture(version = '0.2.1-alpha.2') {
  await mkdir(artifacts, { recursive: true })
  const root = await mkdtemp(join(artifacts, 'checkout-'))
  roots.push(root)
  const reference = join(root, 'packages/typert-protocol-reference')
  const modules = join(root, 'packages/jev/node_modules')
  const installed = join(modules, '@deepseek-ai/dsh-typert-protocol')
  await mkdir(join(installed, 'lib/types'), { recursive: true })
  await mkdir(reference, { recursive: true })
  await writeFile(join(root, 'packages/jev/package.json'), '{}')
  await writeFile(join(reference, 'package.json'), '{}')
  await writeFile(join(installed, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-typert-protocol', version }))
  await writeFile(join(installed, 'lib/types/index.d.ts'), "export type { Sample } from './sample.js'\n")
  await writeFile(join(installed, 'lib/types/sample.d.ts'), 'export interface Sample { value: string }\n')
  await writeFile(join(installed, 'lib/types/ignored.txt'), 'not a declaration')
  return { root, reference, modules, installed }
}

it('prepares a fresh reference with resolvable dependencies and supports repeated runs', async () => {
  const { root, reference, modules, installed } = await fixture()
  for (let run = 0; run < 2; run++) {
    await execute(process.execPath, [script], { cwd: root, timeout: 10_000 })
    expect(await readFile(join(reference, 'src/index.d.ts'), 'utf8')).toBe("export type { Sample } from './sample.js'\n")
    expect(await readFile(join(reference, 'src/sample.d.ts'), 'utf8')).toBe(`export interface Sample { value: ${run === 0 ? 'string' : 'number'} }\n`)
    await expect(lstat(join(reference, 'src/ignored.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await lstat(join(reference, 'node_modules'))).isSymbolicLink()).toBe(true)
    expect(await realpath(join(reference, 'node_modules'))).toBe(await realpath(modules))
    const require = createRequire(join(reference, 'package.json'))
    expect(await realpath(require.resolve('@deepseek-ai/dsh-typert-protocol/package.json'))).toBe(await realpath(join(installed, 'package.json')))
    if (run === 0) await writeFile(join(installed, 'lib/types/sample.d.ts'), 'export interface Sample { value: number }\n')
  }
})

it('rejects an unexpected protocol version before preparing the reference', async () => {
  const { root, reference } = await fixture('0.2.1-alpha.3')
  const result = await execute(process.execPath, [script], { cwd: root, timeout: 10_000 }).catch(error => error)
  expect(result.code).toBe(1)
  expect(result.stderr).toContain('Expected @deepseek-ai/dsh-typert-protocol@0.2.1-alpha.2, found 0.2.1-alpha.3')
  await expect(lstat(join(reference, 'src'))).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(lstat(join(reference, 'node_modules'))).rejects.toMatchObject({ code: 'ENOENT' })
})
