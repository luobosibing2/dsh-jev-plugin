/** Run one bounded real-service case through the installed, published DSH CLI. */
import { spawn } from 'node:child_process'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { createWriteStream, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const project = fileURLToPath(new URL('../..', import.meta.url))
const artifacts = resolve(process.env.JEV_VALIDATION_ARTIFACTS_DIR ?? join(project, '.artifacts/latest-harness-validation'))
const cli = join(project, '.artifacts/harness-runtime/node_modules/.bin/dsh')
const caseId = process.argv[2]
const definitions = {
  'default-off': { features: [], prompt: 'Reply with exactly HARNESS_REAL_SMOKE_OK. Do not use tools.', probe: true },
  'file-ranking': { features: ['file-ranking'], prompt: 'Use the native glob tool exactly once with pattern "*.ts" in the current directory. From the returned original paths identify the auth password reset implementation. Read that file and return its exported marker. Do not run bash or another file scan.' },
  'glob-zero': { features: ['file-ranking'], prompt: 'Use the native glob tool exactly once with pattern "*.missing" in the current directory. State whether any paths matched. Do not use bash.' },
  'glob-forty-one': { features: ['file-ranking'], prompt: 'Use the native glob tool exactly once with pattern "*.ts" in the current directory. State the number of matched paths. Do not read any files or use bash.' },
  'skill-selection': { features: ['skill-selection'], prompt: 'Find the available skill for auth password reset validation, load that original skill with the native skill tool, and follow it. Do not browse or edit files.' },
  'output-admission': { features: ['output-admission'], prompt: 'Run exactly "node build.mjs" using native bash. This is a build verification: report the distinct BUILD_RESULT marker and exit status after the command completes. Do not pipe, redirect, or truncate its output.' },
  'test-log-admission': { features: ['test-log-admission'], prompt: 'Run exactly "node --test checks.test.mjs" using native bash. Report the test summary and whether the distinct arithmetic sentinel passed. Do not pipe, redirect, or truncate its output.' },
  'test-log-admission-tap': { features: ['test-log-admission'], prompt: 'Run exactly "node --test --test-reporter=tap checks.test.mjs" using native bash. Report the test summary and whether the distinct arithmetic sentinel passed. Do not pipe, redirect, or truncate its output.' },
  'test-log-admission-neutral': { features: ['test-log-admission'], prompt: 'Run "node --test --test-reporter=tap checks.test.mjs" using native bash. Report pass/fail counts and exit status. Do not pipe, redirect, or truncate command output.' },
  'completion-incomplete': { features: ['completion-check'], prompt: 'Create both summary.txt containing "ready\\n" and checksum.txt containing "checked\\n". Read both files and confirm both are present and correct.', seed: 'incomplete' },
  'completion-control': { features: ['completion-check'], prompt: 'Create summary.txt containing "ready\\n". Read it and confirm it is present and correct.', seed: 'accurate' },
  'instruction-guidance': { features: ['instruction-guidance'], prompt: 'Read guide.txt, then follow the applicable AGENTS.md reporting rule in the final response. Do not edit files.' },
  'workspace-approval': { features: ['workspace-approval'], prompt: 'I explicitly authorize writing the single file ../approval-outside/allowed.txt with exactly APPROVED_ONCE_OK. Use the native write tool with sandbox_permissions danger-full-access and justification "Write the explicitly authorized isolated approval fixture". This is the only requested outside-workspace operation. Then verify this file with the native read tool using the same explicit permission. Report the actual write/read outcome. Do not ask me, launch commands, or change sandbox mode.' },
  'workspace-approval-exact': { features: ['workspace-approval'], prompt: 'Please create exactly this isolated disposable file: ' + join(artifacts, 'workspaces/approval-outside/exact.txt') + '. Write exactly "EXACT_APPROVAL_OK" with the native write tool. I authorize this specific write outside the current workspace and authorize danger-full-access for this one tool operation only. Include a justification naming this explicit file authorization. After the write, report the native tool result. No other outside-workspace actions are requested.' },
  'current-cwd': { features: ['skill-selection', 'instruction-guidance'], prompt: 'First use native working_directory with cd="child". Then load the original skill named child-reporting from the new current directory and follow it. Read guide.txt by its relative path and create report.txt by its relative path with exactly "CURRENT_CWD_OK\\n". Follow child/AGENTS.md and report its marker. Do not use bash or switch directories again.' },
  'current-cwd-project': { features: ['skill-selection'], prompt: 'Use separate model steps in this order: first native working_directory with cd="child"; second native skill with name="child-reporting"; third return exactly the original skill marker. Do not call any other tool or combine working_directory and skill in one step.' },
}
const definition = definitions[caseId]
if (!definition) throw new Error('Unknown bounded validation case')
const caseRoot = join(artifacts, 'cases', caseId)
const workspace = join(artifacts, 'workspaces', caseId)
if (existsSync(join(caseRoot, 'execution.json'))) throw new Error('This case already has evidence; use a fresh JEV_VALIDATION_ARTIFACTS_DIR')
await mkdir(caseRoot, { recursive: true })
await mkdir(workspace, { recursive: true })
if (caseId.startsWith('test-log-admission-')) await writeFile(join(workspace, 'checks.test.mjs'), await readFile(join(artifacts, 'workspaces/test-log-admission/checks.test.mjs')))
if (caseId.startsWith('workspace-approval')) await mkdir(join(artifacts, 'workspaces/approval-outside'), { recursive: true })
const rows = [
  { id: 'credentials', config: { path: process.env.JEV_VALIDATION_CREDENTIAL_FILE ?? join(homedir(), '.dsh/.credentials.yaml'), watch: false } },
  { id: 'agent-default-model', config: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' } },
  { id: 'llm-deepseek', config: { baseURL: 'https://api.deepseek.com/anthropic', apiKeyEnv: 'DEEPSEEK_API_KEY', reasoningEffort: 'high' } },
  { id: 'jev', config: { baseUrl: 'https://api.typesafe.ai/v1/systemone', model: 'jev-1.13.0', credentialRef: 'JEV_SELECTION_REAL_KEY', timeoutMs: 10000, features: Object.fromEntries(definition.features.map(id => [id, true])) } },
  { id: 'session-title-llm', disabled: true },
  { id: 'session-telemetry-otel', config: { mode: 'DISABLED' } },
  { id: 'session-persistence-jsonl', config: { root: join(artifacts, 'home/sessions'), compression: 'none' } },
  { id: 'jev-stage-navigation', disabled: true },
  { id: 'skill-filesystem', config: caseId.startsWith('current-cwd')
    ? { includeDefaultRoots: true, customSkillDirs: [], bundledSkillDir: join(artifacts, 'empty-bundled'), watch: false }
    : { includeDefaultRoots: false, customSkillDirs: [join(artifacts, 'controlled-skills')], watch: false } },
  { insert: [{ id: 'latest-harness-observer', name: join(project, 'scripts/validation/latest-harness-observer.mjs') }] },
]
if (definition.seed) rows.push({ insert: [{ id: 'latest-harness-seeded-first', name: join(project, 'scripts/validation/latest-harness-seed.mjs') }] })
const patch = join(caseRoot, 'patch.json')
await writeFile(patch, JSON.stringify(rows, null, 2) + '\n')
const env = { ...process.env, DSH_HOME: join(artifacts, 'home'), DSH_AGENTS_HOME: join(artifacts, 'agents'),
  JEV_VALIDATION_CASE_ROOT: caseRoot, JEV_VALIDATION_HTTP: join(caseRoot, 'http.jsonl'),
  JEV_VALIDATION_PROBE: definition.probe ? '1' : '0', JEV_VALIDATION_SEED: definition.seed ?? '',
  JEV_VALIDATION_STEP_LIMIT: caseId === 'current-cwd-project' ? '3' : '0', JEV_VALIDATION_MAIN_REQUEST_LIMIT: caseId === 'current-cwd-project' ? '3' : '0',
  NODE_OPTIONS: '--import ' + join(project, 'scripts/validation/latest-harness-fetch.mjs') }
const started = Date.now()
const stdout = createWriteStream(join(caseRoot, 'stdout.jsonl'))
const stderr = createWriteStream(join(caseRoot, 'stderr.log'))
const args = ['--profile', 'compatibility-headless', '--patch', patch, '--json', definition.prompt]
const child = spawn(cli, args, { cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe'] })
child.stdout.pipe(stdout); child.stderr.pipe(stderr)
let timedOut = false
const timeout = setTimeout(() => { timedOut = true; child.kill('SIGTERM') }, 240_000)
const outcome = await new Promise((done, fail) => { child.once('error', fail); child.once('exit', (code, signal) => done({ code, signal })) })
clearTimeout(timeout)
await Promise.all([new Promise(resolve => stdout.end(resolve)), new Promise(resolve => stderr.end(resolve))])
const summary = { caseId, features: definition.features, layer: definition.seed ? 'scripted-initial-real-Jev-real-Flash-supplement' : 'real-Flash-real-Jev-native-profile', cli, args, workspace, elapsedMs: Date.now() - started, timedOut, ...outcome }
await writeFile(join(caseRoot, 'execution.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(JSON.stringify(summary))
if (outcome.code !== 0 || timedOut) process.exitCode = 1
