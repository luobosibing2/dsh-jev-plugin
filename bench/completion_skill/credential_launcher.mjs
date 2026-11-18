/** Supply one frozen batch's credentials to the serial runner without printing values. */
import { spawn } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const SENSITIVE = /(KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|AUTH)/i

function option(args, name) {
  const index = args.indexOf(name)
  if (index < 0 || !args[index + 1]) throw new Error(`Missing ${name}`)
  return args[index + 1]
}

async function readProtectedJevKey() {
  if (process.stdin.isTTY) throw new Error('Jev key input must be a protected non-TTY pipe')
  const lines = createInterface({ input: process.stdin, terminal: false })
  try {
    for await (const line of lines) {
      const value = line.trim()
      if (!value || value.length > 4096) throw new Error('Invalid Jev key from stdin')
      return value
    }
    throw new Error('Missing Jev key from stdin')
  } finally { lines.close() }
}

async function nextInitialFamily(batch) {
  const slots = JSON.parse(await readFile(resolve(batch, 'schedule.json'), 'utf8')).slots
  for (const slot of slots) {
    const job = JSON.parse(await readFile(resolve(batch, 'slots', String(slot.slot).padStart(2, '0'), 'job.json'), 'utf8'))
    try {
      if ((await readdir(job.jobs_dir)).length) continue
    } catch (error) { if (error?.code !== 'ENOENT') throw error }
    return slot.family
  }
  return null
}

async function main(args) {
  const stdinJev = args.includes('--jev-key-stdin')
  args = args.filter(arg => arg !== '--jev-key-stdin')
  if (!['next', 'run'].includes(args[0]) || !args.includes('--execute')) {
    throw new Error('Use next or run with --batch <path> --execute')
  }
  const batch = resolve(option(args, '--batch'))
  const scenario = JSON.parse(await readFile(resolve(batch, 'scenario-identity.json'), 'utf8')).scenario_id
  if (!['initial-26', 'coding-followup-4', 'skill-repository-8', 'completion-recovery-16'].includes(scenario)) {
    throw new Error('Unknown frozen scenario')
  }
  const manifest = scenario === 'initial-26' ? 'skills/manifest.json' : 'manifest.json'
  const plan = JSON.parse(await readFile(resolve(batch, manifest), 'utf8'))
  if (plan.phase !== 'formal' || plan.model.provider !== 'deepseek-official' ||
      plan.jev.credential_env !== 'JEV_API_KEY') {
    throw new Error('Frozen batch has unsupported credential routing')
  }
  const family = scenario === 'initial-26' ? await nextInitialFamily(batch) : null
  const needsMain = scenario !== 'initial-26' || args[0] === 'run' || family !== 'completion'
  const ctx = new Context()
  ctx.provide('launchEnvironment', loadLayeredEnv('jev-deepswe', ROOT))
  const fiber = ctx.plugin(LocalCredentialProvider, { watch: false })
  try {
    await fiber
    const env = Object.fromEntries(Object.entries(process.env)
      .filter(([name]) => !SENSITIVE.test(name) && name !== 'DSH_HOME'))
    const names = [plan.jev.credential_env, ...(needsMain ? [plan.conditions.main_credential_env] : [])]
    for (const name of names) {
      if (name === 'JEV_API_KEY' && stdinJev) continue
      const availability = await ctx.credentials.describe(credentialRef(name))
      if (!availability.configured) throw new Error(`DSH credential reference ${name} is not configured`)
      const resolved = await ctx.credentials.resolve(credentialRef(name))
      if (!resolved?.value) throw new Error(`DSH credential reference ${name} is unavailable`)
      env[name] = resolved.value
    }
    if (stdinJev) env.JEV_API_KEY = await readProtectedJevKey()
    if (scenario === 'initial-26') {
      env.JEV_CS_CREDENTIAL_LAUNCHER = '1'
      env[plan.conditions.main_credential_env] ??= 'EVAL_MAIN_PLACEHOLDER'
    } else if (scenario === 'coding-followup-4') {
      env.JEV_CODING_FOLLOWUP_LAUNCHER = '1'
    } else if (scenario === 'completion-recovery-16') {
      env.JEV_REC_CREDENTIAL_LAUNCHER = '1'
    } else {
      env.JEV_SF_CREDENTIAL_LAUNCHER = '1'
    }
    env.PYTHONPATH = [ROOT, env.PYTHONPATH].filter(Boolean).join(':')
    const child = spawn('uv', ['run', '--project', plan.paths.pier,
      'python', '-m', 'bench.completion_skill.cli', ...args],
      { cwd: ROOT, env, stdio: 'inherit' })
    return await new Promise((done, fail) => {
      child.once('error', fail)
      child.once('exit', (code, signal) => done(signal ? 128 + (signal === 'SIGINT' ? 2 : 15) : code ?? 1))
    })
  } finally { await fiber.dispose() }
}

try { process.exitCode = await main(process.argv.slice(2)) }
catch (error) {
  console.error(error instanceof Error && /^DSH credential reference [A-Za-z_][A-Za-z0-9_]* (?:is not configured|is unavailable)$/.test(error.message)
    ? error.message : 'Credential launch failed before starting Pier')
  process.exitCode = 2
}
