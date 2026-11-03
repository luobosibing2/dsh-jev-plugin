import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, expect, it } from 'vitest'

const execute = promisify(execFile)
const project = fileURLToPath(new URL('../..', import.meta.url))
const smoke = join(project, 'scripts/validation/compatibility-smoke.mjs')
const manifest = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'))
const temporaryRoots = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => {
    if (!path.startsWith(join(tmpdir(), 'jev-smoke-command-'))) throw new Error('Unexpected cleanup directory')
    return rm(path, { recursive: true, force: true })
  }))
})

it.each(['prepare-official-cli', 'build', 'payload-pack', 'unpack'])('launches package-manager shims and records a %s failure', async phase => {
  const root = await mkdtemp(join(tmpdir(), 'jev-smoke-command-'))
  temporaryRoots.push(root)
  const bin = join(root, 'command shims')
  const artifacts = join(root, 'artifacts with spaces & (parentheses)')
  await mkdir(bin)
  const stub = join(bin, 'package-manager.cjs')
  await writeFile(stub, `
const { mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { execFileSync } = require('node:child_process')
const [command, ...args] = process.argv.slice(2)
if (process.env.SMOKE_STUB_PHASE !== 'unpack' || args[0] !== 'pack') console.log(JSON.stringify({ command, args }))
if (command === 'npm' && args[0] === 'install' && ['build', 'unpack'].includes(process.env.SMOKE_STUB_PHASE)) {
  const cliRoot = join(process.cwd(), 'node_modules/@deepseek-ai/dsh')
  mkdirSync(cliRoot, { recursive: true })
  writeFileSync(join(cliRoot, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh', version: ${JSON.stringify(manifest.devDependencies['@deepseek-ai/dsh'])}, bin: { dsh: 'cli.mjs' },
  }))
} else if (process.env.SMOKE_STUB_PHASE === 'unpack' && command === 'pnpm') {
  // Skip the build: this fixture tests the runner's real tar invocation.
} else if (process.env.SMOKE_STUB_PHASE === 'unpack' && command === 'npm' && args[0] === 'pack') {
  const destination = args[args.indexOf('--pack-destination') + 1]
  mkdirSync(join(destination, 'package'), { recursive: true })
  // Deliberately stop at manifest validation after successful extraction.
  writeFileSync(join(destination, 'package/package.json'), '{}')
  execFileSync('tar', ['-czf', 'fixture.tgz', 'package'], { cwd: destination })
  console.log(JSON.stringify([{ filename: 'fixture.tgz', name: ${JSON.stringify(manifest.name)}, version: ${JSON.stringify(manifest.version)} }]))
} else process.exitCode = 42
`)
  for (const command of ['npm', 'pnpm']) {
    const shim = join(bin, command + (process.platform === 'win32' ? '.cmd' : ''))
    await writeFile(shim, process.platform === 'win32'
      ? `@"${process.execPath}" "${stub}" ${command} %*\r\n`
      : `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' '${stub.replaceAll("'", "'\\''")}' ${command} "$@"\n`)
    await chmod(shim, 0o755)
  }
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'path'))
  env.PATH = bin + delimiter + (Object.entries(process.env).find(([key]) => key.toLowerCase() === 'path')?.[1] ?? '')
  env.SMOKE_STUB_PHASE = phase
  let args = [smoke, '--artifacts', artifacts]
  if (phase === 'payload-pack') {
    const version = manifest.devDependencies['@deepseek-ai/dsh']
    const runtimeMap = join(root, 'runtime-map.json')
    await writeFile(runtimeMap, JSON.stringify({ [version]: join(root, 'unused-cli.mjs') }))
    args = [join(project, 'scripts/validation/compatibility-matrix.mjs'), '--runtime-map', runtimeMap, '--version', version, '--artifacts', artifacts]
  }
  const execution = await execute(process.execPath, args, { cwd: project, env, timeout: 20_000 }).catch(error => error)
  expect(execution.code).toBe(1)
  if (phase === 'payload-pack') {
    expect(execution.stderr).toContain('Experimental payload packaging failed')
    expect(JSON.parse((await readFile(join(artifacts, 'payload-pack.log'), 'utf8')).trim())).toEqual({
      command: 'npm', args: ['pack', join(artifacts, 'payload'), '--ignore-scripts', '--pack-destination', artifacts],
    })
    return
  }
  const summary = JSON.parse(await readFile(join(artifacts, 'smoke-results.json'), 'utf8'))
  expect(summary.passed).toBe(false)
  expect(summary.realModelCalls).toBe(0)
  if (phase === 'unpack') {
    expect(summary.commands.map(command => command.label)).toEqual(['prepare-official-cli', 'build', 'pack', 'unpack'])
    const unpack = summary.commands.at(-1)
    expect(unpack.code).toBe(0)
    expect(unpack.timedOut).toBe(false)
    expect(unpack.cwd).toBe(join(artifacts, 'package'))
    expect(unpack.args).toEqual(['-xzf', 'fixture.tgz', '-C', join(artifacts, 'package/unpacked')])
    expect(JSON.parse(await readFile(join(artifacts, 'package/unpacked/package/package.json'), 'utf8'))).toEqual({})
    expect(summary.failure).toContain('The formal tarball manifest differs from this checkout')
    return
  }
  expect(summary.commands.map(command => command.label)).toEqual(phase === 'build' ? ['prepare-official-cli', 'build'] : [phase])
  const command = summary.commands.at(-1)
  expect(command.code).toBe(42)
  expect(command.timedOut).toBe(false)
  expect(summary.failure).toBe(phase + ' failed; see ' + command.log)
  expect(JSON.parse((await readFile(command.log, 'utf8')).trim())).toEqual(phase === 'build'
    ? { command: 'pnpm', args: ['run', 'build'] }
    : { command: 'npm', args: ['install', '--no-audit', '--no-fund'] })
}, 30_000)
