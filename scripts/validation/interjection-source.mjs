/** Verify regenerated Jev routing through a disposable, source-built DSH SDK profile. */
import assert from 'node:assert/strict'
import { globSync } from 'node:fs'
import { createServer } from 'node:http'
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: {
  'dsh-workspace': { type: 'string' },
  'jev-runtime': { type: 'string' },
} })
if (!values['dsh-workspace'] || !values['jev-runtime']) {
  throw new Error('Pass --dsh-workspace <built DSH checkout> --jev-runtime <regenerated runtime directory>')
}
const dsh = resolve(values['dsh-workspace'])
const runtime = resolve(values['jev-runtime'])
const project = fileURLToPath(new URL('../..', import.meta.url))
const fixture = join(project, 'packages/jev/tests/fixtures/interjection-source.mjs')
const cli = join(dsh, 'apps/cli/lib/bin.js')
const { DeepSeekHarness } = await import(pathToFileURL(join(dsh, 'packages/sdk/client/lib/index.js')).href)
await readFile(cli)
for (const entry of ['index.js', 'interjection.js']) await readFile(join(runtime, entry))

const artifacts = join(dsh, '.artifacts')
await mkdir(artifacts, { recursive: true })
const temp = await mkdtemp(join(artifacts, 'jev-interjection-source-'))
const payload = join(temp, 'plugin')
const packets = []
const serverErrors = []
const summary = { realModelCalls: 0, cases: [] }
const server = createServer(async (request, response) => {
  try {
    assert.equal(request.method, 'POST')
    const route = decodeURIComponent(new URL(request.url, 'http://fixture').pathname.slice(1))
    assert.ok(['interrupt-steer', 'steer', 'follow-up'].includes(route))
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    assert.equal(body.questions.route.type, 'choice')
    assert.deepEqual(Object.keys(body.questions.route.criteria).sort(), ['follow-up', 'interrupt-steer', 'steer', 'unknown'])
    packets.push({ route, body })
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ answers: { route: { choice: route } } }))
  } catch (error) {
    serverErrors.push(error)
    response.writeHead(500, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: error.message }))
  }
})

try {
  // Bare peer imports from the copied runtime and fixture resolve under the
  // DSH checkout. No dependency from Jev's separately installed graph enters
  // the tested Host and no personal profile is installed or modified.
  await mkdir(payload)
  await cp(runtime, join(payload, 'runtime'), { recursive: true })
  await cp(fixture, join(payload, 'fixture.mjs'))
  await writeFile(join(payload, 'package.json'), JSON.stringify({ name: '@dsh-jev/interjection-source-validation', version: '0.0.0', type: 'module' }) + '\n')
  const peers = new Set()
  for (const file of globSync('*.js', { cwd: join(payload, 'runtime') })) {
    const source = await readFile(join(payload, 'runtime', file), 'utf8')
    for (const [, specifier] of source.matchAll(/from\s+["']([^"']+)["']/g)) {
      if (specifier.startsWith('.') || specifier.startsWith('node:')) continue
      peers.add(specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0])
    }
  }
  const workspacePackages = new Map()
  for (const file of globSync(['vendor/*/package.json', 'packages/*/*/package.json'], { cwd: dsh })) {
    const manifest = JSON.parse(await readFile(join(dsh, file), 'utf8'))
    if (peers.has(manifest.name)) workspacePackages.set(manifest.name, dirname(join(dsh, file)))
  }
  const fromDsh = createRequire(join(dsh, 'package.json'))
  for (const peer of peers) {
    const packageRoot = workspacePackages.get(peer) ?? dirname(fromDsh.resolve(`${peer}/package.json`))
    const link = join(payload, 'node_modules', peer)
    await mkdir(dirname(link), { recursive: true })
    await symlink(await realpath(packageRoot), link, process.platform === 'win32' ? 'junction' : 'dir')
  }
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No fixture HTTP port')
  const environment = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => !/(KEY|SECRET|TOKEN|PASSWORD)/i.test(key)
      && !/^(DSH_|JEV_|DEEPSEEK_|OPENAI_|ANTHROPIC_|HTTP_PROXY$|HTTPS_PROXY$|ALL_PROXY$|http_proxy$|https_proxy$|all_proxy$|NODE_OPTIONS$|NODE_USE_ENV_PROXY$)/.test(key)))

  for (const route of ['interrupt-steer', 'steer', 'follow-up']) {
    const caseRoot = join(temp, route)
    const cwd = join(caseRoot, 'workspace')
    await mkdir(cwd, { recursive: true })
    const patch = join(caseRoot, 'fixture.patch.yml')
    await writeFile(patch, JSON.stringify([
      { id: 'llm-deepseek', disabled: true },
      { id: 'session-title-llm', disabled: true },
      { id: 'session-log-deepseek', config: { enabled: false } },
      { id: 'skill-filesystem', config: { includeDefaultRoots: false } },
      { id: 'sdk-jsonrpc-server', inject: ['sdkAppStartup', 'loader', 'jevInterjectionSourceReady'] },
      { insert: [
        { id: 'jev', name: pathToFileURL(join(payload, 'runtime/index.js')).href, config: {
          baseUrl: `http://127.0.0.1:${address.port}/${route}`, model: 'jev-source-fixture',
          credentialRef: 'JEV_SOURCE_VALIDATION_KEY', timeoutMs: 5000, features: { 'interjection-routing': true },
        } },
        { id: 'jev-interjection-routing', name: pathToFileURL(join(payload, 'runtime/interjection.js')).href },
        { id: 'jev-interjection-source-fixture', name: pathToFileURL(join(payload, 'fixture.mjs')).href },
      ] },
    ], null, 2) + '\n')
    const harness = new DeepSeekHarness({
      dshBin: cli, profile: 'sdk', patches: [patch], dshHome: join(caseRoot, 'home'),
      cwd, processCwd: cwd, provider: 'jev-interjection-source', model: 'fixture',
      initializeTimeoutMs: 30_000, requestTimeoutMs: 30_000,
      env: { ...environment, DSH_TELEMETRY_DISABLED: '1', DSH_AGENTS_HOME: join(caseRoot, 'agents'),
        JEV_INTERJECTION_SOURCE_ROOT: caseRoot, JEV_INTERJECTION_SOURCE_ROUTE: route,
        JEV_SOURCE_VALIDATION_KEY: 'local-fixture-key' },
    })
    let result
    let deadline
    try {
      result = await Promise.race([
        harness.run('Review the current implementation.'),
        new Promise((resolve, reject) => {
          deadline = setTimeout(() => { reject(new Error(`${route}: the owned SDK activity did not finish within 30 seconds`)) }, 30_000)
          deadline.unref()
        }),
      ])
    } finally {
      clearTimeout(deadline)
      await harness.close()
    }
    assert.deepEqual(serverErrors, [])
    assert.equal(result.finishReason, 'completed', JSON.stringify(result.events.filter(event => event.type === 'turn/end')))
    assert.equal(result.finalResponse, 'CORRECTED_RESPONSE')
    const observations = JSON.parse(await readFile(join(caseRoot, 'observations.json'), 'utf8'))
    const turns = result.events.filter(event => event.type === 'turn/end').map(event => event.data.turn)
    assert.deepEqual(turns, route === 'follow-up' ? [1, 2] : [1])
    assert.equal(observations.requests.length, 2)
    assert.equal(observations.firstRequestAborted, route === 'interrupt-steer')
    assert.equal(observations.requests[0].aborted, route === 'interrupt-steer')
    assert.equal(observations.requests[1].aborted, false)
    assert.equal(observations.userMessages.filter(message => message.text === observations.correction).length, 1)
    assert.equal(new Set(observations.userMessages.map(message => message.id)).size, 2)
    assert.equal(observations.requests[1].messages.filter(message => message.text === observations.correction).length, 1)
    const judged = packets.filter(packet => packet.route === route)
    assert.equal(judged.length, 1)
    assert.equal(judged[0].body.state.message, observations.correction)
    assert.equal(judged[0].body.state.activity, 'model-response')
    assert.equal(judged[0].body.state.taskMessages[0].text, 'Review the current implementation.')
    const attempts = result.events.filter(event => event.type === 'assistant/attempt')
    assert.equal(attempts.length, route === 'interrupt-steer' ? 1 : 0)
    if (route === 'interrupt-steer') {
      assert.deepEqual(attempts[0].data.stream, [])
      assert.ok(observations.phases.includes('interrupt-requested'))
      assert.ok(observations.phases.includes('response-settled'))
    } else {
      assert.ok(!observations.phases.includes('interrupt-requested'))
      assert.ok(!observations.phases.includes('response-settled'))
    }
    summary.cases.push({ route, turns, mainRequests: observations.requests.length, judgeRequests: judged.length,
      firstRequestAborted: observations.firstRequestAborted, finalResponse: result.finalResponse })
  }
  console.log(JSON.stringify(summary, null, 2))
} finally {
  if (server.listening) {
    server.closeAllConnections()
    await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()))
  }
  await rm(temp, { recursive: true, force: true })
}
