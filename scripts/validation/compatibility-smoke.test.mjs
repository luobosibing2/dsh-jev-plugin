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

it.each(['prepare-official-cli', 'build', 'payload-pack'])('launches package-manager shims and records a %s failure', async phase => {
  const root = await mkdtemp(join(tmpdir(), 'jev-smoke-command-'))
  temporaryRoots.push(root)
  const bin = join(root, 'command shims')
  const artifacts = join(root, 'artifacts with spaces & (parentheses)')
  await mkdir(bin)
  const stub = join(bin, 'package-manager.cjs')
  await writeFile(stub, `
const { mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const [command, ...args] = process.argv.slice(2)
console.log(JSON.stringify({ command, args }))
if (command === 'npm' && process.env.SMOKE_STUB_PHASE === 'build') {
  const cliRoot = join(process.cwd(), 'node_modules/@deepseek-ai/dsh')
  mkdirSync(cliRoot, { recursive: true })
  writeFileSync(join(cliRoot, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh', version: ${JSON.stringify(manifest.devDependencies['@deepseek-ai/dsh'])}, bin: { dsh: 'cli.mjs' },
  }))
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
  expect(summary.commands.map(command => command.label)).toEqual(phase === 'build' ? ['prepare-official-cli', 'build'] : [phase])
  const command = summary.commands.at(-1)
  expect(command.code).toBe(42)
  expect(command.timedOut).toBe(false)
  expect(summary.failure).toBe(phase + ' failed; see ' + command.log)
  expect(JSON.parse((await readFile(command.log, 'utf8')).trim())).toEqual(phase === 'build'
    ? { command: 'pnpm', args: ['run', 'build'] }
    : { command: 'npm', args: ['install', '--no-audit', '--no-fund'] })
}, 30_000)
