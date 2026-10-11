/** Verify an experimental plugin tarball through explicitly selected official DSH CLIs. */
import { parseArgs } from 'node:util'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, writeFile, readFile, cp, stat, symlink } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const project = fileURLToPath(new URL('../..', import.meta.url))
const { values } = parseArgs({ options: { artifacts: { type: 'string' }, 'runtime-map': { type: 'string' }, version: { type: 'string' }, 'final-package': { type: 'string' }, 'keep-web': { type: 'boolean', default: false } } })
if (!values.artifacts || !values['runtime-map']) throw new Error('Pass --artifacts and --runtime-map; existing case evidence is never overwritten')
const artifacts = resolve(values.artifacts)
const runtimeMap = JSON.parse(await readFile(resolve(values['runtime-map']), 'utf8'))
const targetVersions = ['0.1.7-rc.1', '0.1.7-rc.2', '0.2.0-rc.1', '0.2.0-rc.2', '0.2.1-alpha.2']
const versions = values.version ? [values.version] : targetVersions
for (const version of versions) if (!targetVersions.includes(version) || !runtimeMap[version]) throw new Error('Missing explicit supported runtime for ' + version)
await mkdir(artifacts, { recursive: true })
const summary = { experimentalManifest: !values['final-package'], versions: [], realModelCalls: 0, platform: process.platform }
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/(KEY|SECRET|TOKEN|PASSWORD)/i.test(key) && !['DSH_HOME', 'DSH_PROFILE', 'DEEPSEEK_BASE_URL', 'NODE_OPTIONS'].includes(key)))
env.CI = 'true'
env.npm_config_cache = join(artifacts, 'npm-cache')
env.npm_config_store_dir = join(artifacts, 'pnpm-store')
async function exists(path) { try { await stat(path); return true } catch (error) { if (error.code === 'ENOENT') return false; throw error } }
async function save() { await writeFile(join(artifacts, 'results.json'), JSON.stringify(summary, null, 2) + '\n') }
async function command(label, command, args, commandEnv) {
  const logPath = join(artifacts, label + '.log')
  const log = createWriteStream(logPath, { flags: 'wx' })
  const child = spawn(command, args, { cwd: project, env: commandEnv, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false })
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM') }, 180_000)
  const outcome = await new Promise((done, fail) => { child.once('error', fail); child.once('close', (code, signal) => done({ code, signal })) })
  clearTimeout(timer)
  await new Promise(done => log.end(done))
  return { command, args, log: logPath, ...outcome, timedOut }
}
let tarball = values['final-package'] && resolve(values['final-package'])
if (!tarball) {
  const payload = join(artifacts, 'payload')
  if (await exists(payload)) throw new Error('Artifact payload already exists; select a fresh --artifacts directory')
  await mkdir(join(payload, 'packages/jev'), { recursive: true })
  const manifest = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'))
  for (const name of Object.keys(manifest.peerDependencies)) {
    if (name.startsWith('@deepseek-ai/dsh-')) manifest.peerDependencies[name] = targetVersions.join(' || ')
    else if (name.startsWith('@deepseek-ai/cordis')) manifest.peerDependencies[name] = '*'
  }
  await writeFile(join(payload, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
  await cp(join(project, 'runtime'), join(payload, 'runtime'), { recursive: true })
  await cp(join(project, 'packages/jev/cordis.patch.yml'), join(payload, 'packages/jev/cordis.patch.yml'))
  for (const name of ['README.md', 'README.en.md', 'README.zh-CN.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) if (await exists(join(project, name))) await cp(join(project, name), join(payload, name))
  const packed = await command('payload-pack', 'npm', ['pack', payload, '--ignore-scripts', '--pack-destination', artifacts], env)
  if (packed.code !== 0 || packed.timedOut) throw new Error('Experimental payload packaging failed')
  tarball = join(artifacts, manifest.name.replace('@', '').replace('/', '-') + '-' + manifest.version + '.tgz')
}
summary.tarball = tarball
for (const version of versions) {
  const caseRoot = join(artifacts, version)
  if (await exists(caseRoot)) throw new Error('Case evidence already exists for ' + version)
  await mkdir(caseRoot)
  const packets = []
  const server = createServer(async (request, response) => {
    try {
      const chunks = []; for await (const chunk of request) chunks.push(chunk)
      const body = JSON.parse(Buffer.concat(chunks).toString())
      packets.push(body)
      const answers = Object.fromEntries(Object.entries(body.questions).map(([id, question]) => {
        if (question.type === 'choice') {
          const options = Object.keys(question.criteria)
          const preferred = ['support', 'approve', 'correction', 'conflict', 'complete', 'on-track', 'progress', 'support', 'implementation'].find(option => options.includes(option))
          const choice = preferred ?? options.find(option => !option.startsWith('$')) ?? options[0]
          return [id, { choice, probabilities: Object.fromEntries(options.map(option => [option, options.length === 1 ? 1 : option === choice ? 0.99 : 0.01 / (options.length - 1)])) }]
        }
        if (question.type === 'score') return [id, { score: Math.max(0, (question.criteria.length - 1) / 2) }]
        return [id, { noul: 0.99 }]
      }))
      response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ answers, model: 'deterministic-local-fixture', usage: { input_tokens: 7, output_tokens: 3 } }))
    } catch (error) { response.writeHead(500); response.end(JSON.stringify({ error: error.message })) }
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  const endpoint = 'http://127.0.0.1:' + server.address().port + '/v1/systemone'
  const home = join(caseRoot, 'home')
  const credentials = join(caseRoot, 'credentials.yaml')
  await writeFile(credentials, 'version: 1\nrefs:\n  JEV_COMPAT_KEY: local-compatibility-fixture\n', { mode: 0o600 })
  const commandEnv = { ...env, DSH_HOME: home, DSH_AGENTS_HOME: join(caseRoot, 'agents'), JEV_COMPAT_CASE_ROOT: caseRoot, JEV_COMPAT_VERSION: version }
  const item = { version, cli: runtimeMap[version], endpoint, caseRoot }
  summary.versions.push(item); await save()
  const cli = runtimeMap[version]
  item.versionCheck = await command(version + '-version', 'node', [cli, '--version'], commandEnv)
  item.observedVersion = (await readFile(item.versionCheck.log, 'utf8')).trim()
  if (item.versionCheck.code !== 0 || item.versionCheck.timedOut || item.observedVersion !== version) { process.exitCode = 1; await save(); await new Promise(done => server.close(done)); break }
  item.initialize = await command(version + '-initialize', 'node', [cli, '--profile', 'compatibility', '--from-default-profile', 'web', '--dump-default-config'], commandEnv)
  if (item.initialize.code !== 0 || item.initialize.timedOut) { process.exitCode = 1; await save(); await new Promise(done => server.close(done)); break }
  item.install = await command(version + '-install', 'node', [cli, 'plugin', '--profile', 'compatibility', 'add', tarball], commandEnv)
  if (item.install.code !== 0 || item.install.timedOut) { process.exitCode = 1; await save(); await new Promise(done => server.close(done)); break }
  for (const marker of ['a', 'b']) {
    const cwd = join(caseRoot, 'projects', marker)
    await mkdir(join(cwd, '.git'), { recursive: true })
    await mkdir(join(cwd, '.agents/skills/compat-' + marker), { recursive: true })
    await writeFile(join(cwd, '.agents/skills/compat-' + marker, 'SKILL.md'), '---\nname: compat-' + marker + '\ndescription: Work on compatibility project ' + marker.toUpperCase() + ' only.\n---\n\nReturn ORIGINAL_SKILL_' + marker.toUpperCase() + '.\n')
    await writeFile(join(cwd, 'AGENTS.md'), '# Isolated project\n\nUse only project ' + marker.toUpperCase() + ' material. Include RULE_' + marker.toUpperCase() + ' after reading guide.txt.\n')
    await writeFile(join(cwd, 'guide.txt'), 'GUIDE_' + marker.toUpperCase() + '\n')
    await writeFile(join(cwd, 'second.txt'), 'SECOND_' + marker.toUpperCase() + '\n')
    await writeFile(join(cwd, 'build.mjs'), 'console.log("Start build");\nfor(let i=0;i<500;i++) console.log("Building "+i+"/500");\nconsole.log("BUILD_RESULT:COMPAT_OK");\n')
    await writeFile(join(cwd, 'checks.test.mjs'), 'import test from "node:test";\nimport assert from "node:assert/strict";\nfor(let i=0;i<30;i++)test("ordinary arithmetic validation "+i+" "+"routine-passing-detail-".repeat(8),()=>assert.equal(i+1-1,i));\ntest("compatibility sentinel",()=>assert.equal(41+1,42));\n')
  }
  await mkdir(join(caseRoot, 'empty-bundled'))
  const fixtureDir = join(home, 'profiles/compatibility/fixture')
  await mkdir(join(fixtureDir, 'node_modules'), { recursive: true })
  await writeFile(join(fixtureDir, 'package.json'), '{"name":"@dsh-jev/compatibility-fixture","private":true,"type":"module"}\n')
  await symlink(join(dirname(cli), '../../../@deepseek-ai'), join(fixtureDir, 'node_modules/@deepseek-ai'), 'dir')
  const fixturePath = join(fixtureDir, 'compatibility-profile.mjs')
  await cp(join(project, 'packages/jev/tests/fixtures/compatibility-profile.mjs'), fixturePath)
  const patch = [
    { id: 'credentials', config: { path: credentials, watch: false } },
    { id: 'session-title-llm', disabled: true },
    { id: 'session-telemetry-otel', config: { mode: 'DISABLED' } },
    { id: 'skill-filesystem', config: { includeDefaultRoots: true, customSkillDirs: [], bundledSkillDir: join(caseRoot, 'empty-bundled'), watch: false } },
    { id: 'jev', config: { baseUrl: endpoint, model: 'fixture', credentialRef: 'JEV_COMPAT_KEY', timeoutMs: 5000, features: Object.fromEntries(['skill-selection', 'file-ranking', 'instruction-guidance', 'completion-check', 'drift-monitoring', 'goal-supervision', 'interjection-routing', 'shared-findings', 'output-admission', 'test-log-admission', 'workspace-approval', 'stage-navigation'].map(id => [id, true])) } },
    { id: 'jev-supervision', config: { driftInterval: 1, evidenceChars: 1_000_000 } },
    { insert: [{ id: 'jev-compatibility-profile', name: fixturePath }] },
  ]
  const patchPath = join(caseRoot, 'patch.json'); await writeFile(patchPath, JSON.stringify(patch, null, 2) + '\n')
  const logPath = join(caseRoot, 'host.log')
  const log = createWriteStream(logPath, { flags: 'wx' })
  const args = [cli, '--profile', 'compatibility', '--patch', patchPath, '--host', '127.0.0.1', '--port', '0', '--no-open']
  const child = spawn('node', args, { cwd: project, env: commandEnv, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false })
  const close = new Promise((done, fail) => { child.once('error', fail); child.once('close', (code, signal) => done({ code, signal })) })
  let outcome; close.then(value => { outcome = value })
  const deadline = Date.now() + 120_000
  while (!outcome && !await exists(join(caseRoot, 'fixture-result.json')) && Date.now() < deadline) await new Promise(done => setTimeout(done, 50))
  item.host = { command: 'node', args, log: logPath, fixtureTimedOut: !outcome && !await exists(join(caseRoot, 'fixture-result.json')), naturalExit: outcome ?? null }
  if (await exists(join(caseRoot, 'fixture-result.json'))) item.fixture = JSON.parse(await readFile(join(caseRoot, 'fixture-result.json'), 'utf8'))
  if (values['keep-web'] && item.fixture?.ok) {
    item.host.keptRunningPid = child.pid
    console.log(JSON.stringify({ version, pid: child.pid, log: logPath, caseRoot }))
    await save()
    await new Promise(done => {
      const stop = () => { process.off('SIGINT', stop); process.off('SIGTERM', stop); done() }
      process.once('SIGINT', stop); process.once('SIGTERM', stop)
    })
  }
  if (!outcome) child.kill('SIGINT')
  const killTimer = setTimeout(() => child.kill('SIGKILL'), 15_000)
  item.host.finalExit = await close; clearTimeout(killTimer)
  await new Promise(done => log.end(done))
  await writeFile(logPath, (await readFile(logPath, 'utf8')).replace(/(\?token=)[A-Za-z0-9_-]+/g, '$1[REDACTED_SECRET]'))
  server.closeAllConnections(); await new Promise(done => server.close(done))
  await writeFile(join(caseRoot, 'http-packets.json'), JSON.stringify(packets, null, 2) + '\n')
  item.httpPacketCount = packets.length
  await save()
  console.log(JSON.stringify({ version, install: item.install.code, ok: item.fixture?.ok ?? false, failure: item.fixture?.failure, host: item.host.finalExit, packets: packets.length }))
  if (!item.fixture?.ok || item.host.fixtureTimedOut) { process.exitCode = 1; break }
}
