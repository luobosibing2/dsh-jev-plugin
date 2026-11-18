import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { installGeneratedRemoteRuntime } from './generated-remote-runtime.mjs'

const roots = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(helper = 'export const createTypertRemoteInfo = (spec) => spec\n') {
  const root = await mkdtemp(join(tmpdir(), 'jev-remote-runtime-'))
  roots.push(root)
  const published = join(root, 'published-helper.js')
  await writeFile(published, helper)
  for (const name of ['typert.host.js', 'typert.remote-client.js']) {
    await writeFile(join(root, name), "import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info'\nexport const remote = createTypertRemoteInfo({})\n")
  }
  return { root, published, helper }
}

it('ships the published helper unchanged and resolves both generated entries locally', async () => {
  const { root, published, helper } = await fixture()
  await installGeneratedRemoteRuntime(root, published)
  expect(await readFile(join(root, 'typert.remote-info.js'), 'utf8')).toBe(helper)
  for (const name of ['typert.host.js', 'typert.remote-client.js']) {
    expect(await readFile(join(root, name), 'utf8')).toContain("from './typert.remote-info.js'")
    expect((await import(pathToFileURL(join(root, name)).href)).remote).toEqual({})
  }
})

it.each([
  "import 'external-package'\n",
  "export { value } from 'external-package'\n",
  "export const value = import('external-package')\n",
  "export const value = require('external-package')\n",
])('rejects a published helper with a runtime dependency: %s', async helper => {
  const { root, published } = await fixture(helper)
  await expect(installGeneratedRemoteRuntime(root, published)).rejects.toThrow('no runtime module dependencies')
  expect(await readFile(join(root, 'typert.host.js'), 'utf8')).toContain('@deepseek-ai/dsh-typert-protocol/remote-info')
})

it('rejects changed generator imports instead of publishing unresolved entries', async () => {
  const { root, published } = await fixture()
  await writeFile(join(root, 'typert.host.js'), 'export const remote = {}\n')
  await expect(installGeneratedRemoteRuntime(root, published)).rejects.toThrow('Expected one published Remote helper import in typert.host.js')
})
