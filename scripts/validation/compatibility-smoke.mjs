/** Build the formal plugin package and verify it with an isolated official DSH release. */
import { deepStrictEqual } from 'node:assert/strict'
import spawn from 'cross-spawn'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { supportedVersions } from './compatibility-versions.mjs'

const project = fileURLToPath(new URL('../..', import.meta.url))
const { values } = parseArgs({ options: {
  version: { type: 'string' },
  artifacts: { type: 'string' },
  help: { type: 'boolean', short: 'h', default: false },
} })
if (values.help) {
  console.log('Usage: pnpm run test:compatibility [--version <supported exact DSH version>] [--artifacts <new directory>]\nRequires npm, pnpm, tar and Playwright Chromium (pnpm exec playwright install chromium).')
  process.exit(0)
}
const manifest = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'))
const version = values.version ?? manifest.devDependencies['@deepseek-ai/dsh']
if (!supportedVersions.includes(version)) throw new Error('Select a supported exact DSH version: ' + supportedVersions.join(', '))
const temp = join(project, '.artifacts/temp')
await mkdir(temp, { recursive: true })
const artifacts = values.artifacts ? resolve(values.artifacts) : await mkdtemp(join(temp, 'compatibility-smoke-'))
if (values.artifacts) await mkdir(artifacts)
const summaryPath = join(artifacts, 'smoke-results.json')
const summary = { version, platform: process.platform, formalPackage: true, realModelCalls: 0, passed: false, commands: [] }
const environmentRoot = join(artifacts, 'environment')
const taskHome = join(environmentRoot, 'task-home')
await mkdir(taskHome, { recursive: true })
const npmUserConfig = join(environmentRoot, 'npm-user-config')
const npmGlobalConfig = join(environmentRoot, 'npm-global-config')
await writeFile(npmUserConfig, '')
await writeFile(npmGlobalConfig, '')
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/(KEY|SECRET|TOKEN|PASSWORD)/i.test(key)
  && !/^(DSH_|JEV_|DEEPSEEK_|OPENAI_|ANTHROPIC_|npm_config_|NPM_CONFIG_|XDG_)/.test(key)
  && !['NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS'].includes(key)))
Object.assign(env, {
  CI: 'true', NODE_ENV: 'production',
  XDG_CONFIG_HOME: join(taskHome, 'config'), XDG_CACHE_HOME: join(taskHome, 'cache'), XDG_DATA_HOME: join(taskHome, 'data'),
  DSH_HOME: join(environmentRoot, 'dsh'), DSH_AGENTS_HOME: join(environmentRoot, 'agents'),
  npm_config_userconfig: npmUserConfig, npm_config_globalconfig: npmGlobalConfig,
  npm_config_cache: join(environmentRoot, 'npm-cache'), npm_config_registry: 'https://registry.npmjs.org/',
})
// Chromium binaries are shared dependencies; browser contexts and DSH profiles remain disposable.
if (process.env.PLAYWRIGHT_BROWSERS_PATH) env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH
else env.PLAYWRIGHT_BROWSERS_PATH = process.platform === 'darwin'
  ? join(process.env.HOME, 'Library/Caches/ms-playwright')
  : process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA ?? join(process.env.HOME, 'AppData/Local'), 'ms-playwright')
    : join(process.env.XDG_CACHE_HOME ?? join(process.env.HOME, '.cache'), 'ms-playwright')

async function save() {
  await writeFile(summaryPath, JSON.stringify(summary, null, 2) + '\n')
}

async function command(label, executable, args, cwd = project, timeoutMs = 600_000) {
  console.log('[compatibility] ' + label)
  const logPath = join(artifacts, label + '.log')
  const log = createWriteStream(logPath, { flags: 'wx' })
  const child = spawn(executable, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.pipe(log, { end: false })
  child.stderr.pipe(log, { end: false })
  let timedOut = false
  let killTimer
  const timer = setTimeout(() => {
    timedOut = true
    child.kill('SIGTERM')
    killTimer = setTimeout(() => child.kill('SIGKILL'), 15_000)
  }, timeoutMs)
  let outcome
  try {
    outcome = await new Promise((done, fail) => {
      child.once('error', fail)
      child.once('close', (code, signal) => done({ code, signal }))
    })
  } finally {
    clearTimeout(timer)
    clearTimeout(killTimer)
    await new Promise(done => log.end(done))
  }
  const result = { label, command: executable, args, cwd, log: logPath, ...outcome, timedOut }
  summary.commands.push(result)
  await save()
  if (outcome.code !== 0 || timedOut) throw new Error(label + ' failed; see ' + logPath)
  return result
}

function targets(value) {
  if (typeof value === 'string') return value.startsWith('./') ? [value.slice(2)] : []
  if (value && typeof value === 'object') return Object.values(value).flatMap(targets)
  return []
}

async function runtimeFiles(directory, prefix = '') {
  const paths = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = join(prefix, entry.name)
    if (entry.isDirectory()) paths.push(...await runtimeFiles(join(directory, entry.name), relative))
    else if (entry.isFile() && /\.(js|d\.ts)$/.test(entry.name)) paths.push(relative.split(sep).join('/'))
  }
  return paths
}

try {
  await save()
  const runtimeRoot = join(artifacts, 'official-runtime')
  await mkdir(runtimeRoot)
  await writeFile(join(runtimeRoot, 'package.json'), JSON.stringify({ name: 'jev-compatibility-runtime', private: true, dependencies: { '@deepseek-ai/dsh': version } }, null, 2) + '\n')
  await command('prepare-official-cli', 'npm', ['install', '--no-audit', '--no-fund'], runtimeRoot)
  const cliRoot = join(runtimeRoot, 'node_modules/@deepseek-ai/dsh')
  const cliManifest = JSON.parse(await readFile(join(cliRoot, 'package.json'), 'utf8'))
  if (cliManifest.name !== '@deepseek-ai/dsh' || cliManifest.version !== version) throw new Error('Installed CLI identity differs from @deepseek-ai/dsh@' + version)
  const bin = typeof cliManifest.bin === 'string' ? cliManifest.bin : cliManifest.bin?.dsh
  if (!bin) throw new Error('The official DSH package has no dsh CLI')
  const cli = resolve(cliRoot, bin)
  const runtimeMap = join(artifacts, 'runtime-map.json')
  await writeFile(runtimeMap, JSON.stringify({ [version]: cli }, null, 2) + '\n')
  summary.runtime = { name: cliManifest.name, version: cliManifest.version, cli, runtimeMap }
  await command('build', 'pnpm', ['run', 'build'])
  const packageRoot = join(artifacts, 'package')
  await mkdir(packageRoot)
  const packed = await command('pack', 'npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', packageRoot])
  const [pack] = JSON.parse(await readFile(packed.log, 'utf8'))
  if (!pack?.filename || pack.name !== manifest.name || pack.version !== manifest.version) throw new Error('npm pack returned another package identity')
  const tarball = join(packageRoot, pack.filename)
  const unpacked = join(packageRoot, 'unpacked')
  await mkdir(unpacked)
  await command('unpack', 'tar', ['-xzf', tarball, '-C', unpacked])
  const payload = join(unpacked, 'package')
  const packedManifest = JSON.parse(await readFile(join(payload, 'package.json'), 'utf8'))
  deepStrictEqual(packedManifest, manifest, 'The formal tarball manifest differs from this checkout')
  const declaredFiles = [...new Set([...targets(manifest.main), ...targets(manifest.types), ...targets(manifest.exports), ...targets(manifest.dsh.bundle.patch)])].sort()
  for (const required of ['runtime/index.js', 'runtime/client.js', 'runtime/typert.host.js', 'runtime/typert.remote-client.js', 'packages/jev/cordis.patch.yml']) {
    if (!declaredFiles.includes(required)) throw new Error('The formal manifest no longer declares ' + required)
  }
  const comparisonFiles = [...new Set([...declaredFiles, ...(await runtimeFiles(join(project, 'runtime'))).map(path => 'runtime/' + path)])].sort()
  const comparisons = []
  for (const path of comparisonFiles) {
    const source = await readFile(join(project, path))
    const shipped = await readFile(join(payload, path))
    if (!source.equals(shipped)) throw new Error('Packed file differs from the fresh build: ' + path)
    comparisons.push({ path, bytes: shipped.length, sha256: createHash('sha256').update(shipped).digest('hex') })
  }
  summary.package = { name: pack.name, version: pack.version, tarball, sha256: createHash('sha256').update(await readFile(tarball)).digest('hex'), manifestMatches: true, declaredFiles, comparisons }
  await save()
  const matrixArtifacts = join(artifacts, 'matrix')
  await command('matrix', process.execPath, [join(project, 'scripts/validation/compatibility-matrix.mjs'), '--runtime-map', runtimeMap, '--artifacts', matrixArtifacts, '--version', version, '--final-package', tarball, '--check-web'], project, 900_000)
  const matrix = JSON.parse(await readFile(join(matrixArtifacts, 'results.json'), 'utf8'))
  const [item] = matrix.versions
  if (matrix.experimentalManifest || matrix.realModelCalls !== 0 || matrix.versions.length !== 1 || item.version !== version || !item.fixture?.ok || !item.web?.ok) throw new Error('The matrix did not verify the formal Host and Web package')
  summary.matrix = { results: join(matrixArtifacts, 'results.json'), officialInstallExitStatus: item.install.code, fixturePassed: item.fixture.ok, webPassed: item.web.ok }
  summary.passed = true
} catch (error) {
  summary.failure = error.message
  process.exitCode = 1
} finally {
  await save()
  console.log(JSON.stringify({ passed: summary.passed, version, artifacts, results: summaryPath, failure: summary.failure }))
}
