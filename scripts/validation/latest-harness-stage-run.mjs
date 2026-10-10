/** Launch and quiesce the supported Web profile for a cold, real-Jev stage case. */
import { spawn } from 'node:child_process'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { createWriteStream, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
const project = fileURLToPath(new URL('../..', import.meta.url))
const artifacts = resolve(process.env.JEV_VALIDATION_ARTIFACTS_DIR ?? join(project, '.artifacts/latest-harness-validation'))
const caseRoot = join(artifacts, 'cases/stage-navigation')
if (existsSync(join(caseRoot, 'execution.json'))) throw new Error('This stage case already has evidence; use a fresh JEV_VALIDATION_ARTIFACTS_DIR')
await mkdir(caseRoot, { recursive: true })
const source = JSON.parse(await readFile(join(artifacts, 'cases/file-ranking/run-observation.json'), 'utf8'))
const sessionId = source.sessionIds[0]
const rows = [
  { id: 'credentials', config: { path: process.env.JEV_VALIDATION_CREDENTIAL_FILE ?? join(homedir(), '.dsh/.credentials.yaml'), watch: false } },
  { id: 'jev', config: { baseUrl: 'https://api.typesafe.ai/v1/systemone', model: 'jev-1.13.0', credentialRef: 'JEV_SELECTION_REAL_KEY', timeoutMs: 10000, features: { 'stage-navigation': true } } },
  { id: 'session-persistence-jsonl', config: { root: join(artifacts, 'home/sessions'), compression: 'none' } },
  { id: 'session-title-llm', disabled: true },
  { id: 'session-telemetry-otel', config: { mode: 'DISABLED' } },
  { insert: [{ id: 'latest-harness-stage', name: join(project, 'scripts/validation/latest-harness-stage.mjs') }] },
]
const patch = join(caseRoot, 'patch.json')
await writeFile(patch, JSON.stringify(rows, null, 2) + '\n')
const env = { ...process.env, DSH_HOME: join(artifacts, 'home'), DSH_AGENTS_HOME: join(artifacts, 'agents'),
  JEV_VALIDATION_CASE_ROOT: caseRoot, JEV_VALIDATION_STAGE_SESSION: sessionId,
  JEV_VALIDATION_HTTP: join(caseRoot, 'http.jsonl'), NODE_OPTIONS: '--import ' + join(project, 'scripts/validation/latest-harness-fetch.mjs') }
const stdout = createWriteStream(join(caseRoot, 'stdout.log'))
const stderr = createWriteStream(join(caseRoot, 'stderr.log'))
const started = Date.now()
const args = ['--profile', 'compatibility-stage', '--patch', patch, '--no-open', '--port', '0']
const child = spawn(join(project, '.artifacts/harness-runtime/node_modules/.bin/dsh'), args, { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] })
child.stdout.pipe(stdout); child.stderr.pipe(stderr)
const exited = new Promise((done, fail) => { child.once('error', fail); child.once('exit', (code, signal) => done({ code, signal })) })
let result
const deadline = Date.now() + 150_000
for (;;) {
  try { result = JSON.parse(await readFile(join(caseRoot, 'done.json'), 'utf8')); break }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  if (Date.now() >= deadline) { result = { ok: false, failure: 'stage timeout' }; break }
  await new Promise(resolve => setTimeout(resolve, 50))
}
child.kill('SIGTERM')
const outcome = await exited
await Promise.all([new Promise(resolve => stdout.end(resolve)), new Promise(resolve => stderr.end(resolve))])
await writeFile(join(caseRoot, 'execution.json'), JSON.stringify({ caseId: 'stage-navigation', layer: 'real-Jev-cold-real-Flash-Session-published-Web-profile', sessionId, args, elapsedMs: Date.now() - started, ...result, ...outcome }, null, 2) + '\n')
console.log(JSON.stringify({ caseId: 'stage-navigation', elapsedMs: Date.now() - started, ...result, ...outcome }))
if (!result.ok) process.exitCode = 1
