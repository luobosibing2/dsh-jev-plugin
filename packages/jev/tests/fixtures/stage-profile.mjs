/** Run the published dsh CLI against this fixture's isolated Web profile. */
import { spawn } from 'node:child_process'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const artifacts = join(root, '.artifacts/stage-validation')
const home = join(artifacts, 'home')
const workspace = join(artifacts, 'workspace')
const profile = 'stage-validation'
const profileManifest = join(home, 'profiles', profile, 'package.json')
const browsePicker = join(dirname(fileURLToPath(import.meta.url)), 'stage-pin-browse-picker.overlay.yml')
const [action, ...args] = process.argv.slice(2)
if (!['init', 'install', 'start'].includes(action)) {
  throw new Error('Usage: node stage-profile.mjs init | install /absolute/plugin.tgz | start')
}
if (resolve(process.env.DSH_HOME ?? '') !== home) {
  throw new Error(`Set DSH_HOME=${home}; refusing another profile home`)
}
await mkdir(workspace, { recursive: true })
const env = { ...process.env, DSH_HOME: home }
for (const key of ['DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL', 'DEEPSEEK_SEARCH_BASE_URL', 'STAGE_FIXTURE_KEY']) delete env[key]

function dsh(parameters, capturePath) {
  return new Promise((resolveRun, rejectRun) => {
    const command = ['--package', '@deepseek-ai/dsh@0.2.1-alpha.2', 'dlx', 'dsh', ...parameters]
    const child = spawn('pnpm', command, { cwd: workspace, env,
      stdio: capturePath === undefined ? 'inherit' : ['ignore', 'pipe', 'inherit'] })
    let output = ''
    if (capturePath !== undefined) child.stdout.setEncoding('utf8').on('data', chunk => { output += chunk })
    child.once('error', rejectRun)
    child.once('exit', async (code, signal) => {
      try {
        if (capturePath !== undefined && code === 0) await writeFile(capturePath, output)
        if (code !== 0) rejectRun(new Error(`published dsh exited with ${code ?? signal}`))
        else resolveRun()
      } catch (error) { rejectRun(error) }
    })
  })
}

if (action === 'init') {
  let exists = true
  try { await readFile(profileManifest) } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    exists = false
  }
  if (!exists) await dsh(['--profile', profile, '--from-default-profile', 'web', '--dump-config'],
    join(artifacts, 'profile-composed.yml'))
  const manifest = JSON.parse(await readFile(profileManifest, 'utf8'))
  if (!manifest.dsh?.profile?.bundles?.includes('@deepseek-ai/dsh-web-app')) {
    throw new Error('Fixture profile was not initialized from the Web template')
  }
  process.stdout.write(`${exists ? 'Reused' : 'Initialized'} official Web profile at ${profileManifest}\n`)
} else if (action === 'install') {
  const archive = args[0]
  if (args.length !== 1 || !isAbsolute(archive)) {
    throw new Error('install needs one absolute plugin archive path')
  }
  if (!(await stat(archive)).isFile()) throw new Error('install archive must be a file')
  await dsh(['plugin', '--profile', profile, 'add', archive])
} else {
  await readFile(profileManifest)
  await readFile(browsePicker)
  await dsh(['--profile', profile, '--patch', browsePicker, '--host', '127.0.0.1', '--port', '0', '--no-open'])
}
