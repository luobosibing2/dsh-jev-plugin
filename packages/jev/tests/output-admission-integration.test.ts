/** Published DSH tool, AgentLoop, PTC, spill, and Session paths for Jev output admission. */
import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import GoalService from '@deepseek-ai/dsh-goal'
import { createUserMessage, LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { PtcRuntime, type PtcRunRequest, type PtcRunResult, type PtcRunSpec } from '@deepseek-ai/dsh-ptc-runtime'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import * as SpillPolicy from '@deepseek-ai/dsh-spill-policy'
import * as ToolBash from '@deepseek-ai/dsh-tool-bash'
import Storage from '@deepseek-ai/dsh-storage'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import Subagents from '@deepseek-ai/dsh-subagent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import UserQuestions from '@deepseek-ai/dsh-user-questions'
import JevService from '../src/index.ts'
import * as outputAdmission from '../src/output-admission.ts'

type ModelEntry = StreamChunk[] | ((request: GenerateOptions) => Promise<StreamChunk[]>)
class Model extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  constructor(private readonly entries: ModelEntry[]) { super() }
  async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(request)
    const entry = this.entries.shift()
    if (entry === undefined) throw new Error('Output admission model script exhausted')
    yield* typeof entry === 'function' ? await entry(request) : entry
  }
}

const text = (value: string): StreamChunk[] => [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'block-end', index: 0, block: { type: 'text', text: value } },
  { type: 'finish', reason: { kind: 'stop' } },
]
const call = (name: 'bash' | 'run_code', args: object): StreamChunk[] => [
  { type: 'block-start', index: 0, blockType: 'tool-call' },
  { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId('output-call'), name, arguments: JSON.stringify(args) } },
  { type: 'finish', reason: { kind: 'tool-calls' } },
]
const user = (value: string) => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: value }] })
const contentText = (blocks: readonly { type: string; text?: string }[]) => blocks.filter(block => block.type === 'text').map(block => block.text ?? '').join('')
const requestToolText = (request: GenerateOptions | undefined) => {
  const result = request?.messages.find(message => message.role === 'tool')
  return result === undefined ? '' : contentText(result.content)
}
const progress = Array.from({ length: 500 }, (_, index) => `Building ${index + 1}/500\n`).join('')
const rawLog = `Start fixture build\n${progress}DISTINCT EVIDENCE: package complete\nFinished fixture build\n`
const passingLog = `PASS fixture.test.ts\n${Array.from({ length: 180 }, (_, index) =>
  `✓ src/feature/case-${index}.test.ts > handles scenario ${index} (12ms)\n`).join('')}Tests 180 passed\n`
const fastest = [17, 42, 143] as const
const timedLog = `PASS fixture.test.ts\n${Array.from({ length: 180 }, (_, index) =>
  `✓ src/feature/case-${index}.test.ts > handles scenario ${index} (${index === 17 ? 1 : index === 42 ? 2 : index === 143 ? 3 : index + 10}ms)\n`).join('')}Tests 180 passed\n`

interface Save { content: string; source: { toolName: string; label: string }; owner: { sessionId: string } }
interface FixtureCandidate { id: string; firstLine: number; lastLine: number; reason: string; text: string }
interface FixtureEvidence {
  source: string
  lineCount: number
  chunks: Array<{ firstLine: number; lastLine: number; text: string; reason: string }>
  exactDuplicateReferences: Array<{ duplicateFirstLine: number; duplicateLastLine: number; originalFirstLine: number; originalLastLine: number; exactTextEqual: boolean }>
  unshownRetainedCandidates: Array<{ firstLine: number; lastLine: number; reason: string }>
}
interface FixtureWire {
  state: { candidates: FixtureCandidate[]; retainedEvidence?: FixtureEvidence;
    outerResultSuffix?: { source: string; text: string }; task?: string; toolIntent?: string }
  questions: Record<string, { criteria?: Record<string, unknown>; options?: Record<string, unknown>; instructions?: string }>
}
function sourceLines(text: string): string[] {
  const rows: string[] = []
  let start = 0
  for (let index = 0; index < text.length; index++) {
    if (text[index] !== '\n') continue
    rows.push(text.slice(start, index + 1))
    start = index + 1
  }
  if (start < text.length) rows.push(text.slice(start))
  return rows
}
function assertEvidenceMatches(raw: string, wire: FixtureWire) {
  const evidence = wire.state.retainedEvidence
  expect(evidence?.source).toBe('tool-result-logs')
  if (evidence === undefined) throw new Error('Jev did not receive retained evidence')
  const rows = sourceLines(raw)
  expect(evidence.lineCount).toBe(rows.length)
  const selected = new Set<number>()
  for (const candidate of wire.state.candidates) {
    expect(candidate.text).toBe(rows.slice(candidate.firstLine - 1, candidate.lastLine).join(''))
    for (let line = candidate.firstLine; line <= candidate.lastLine; line++) {
      expect(selected.has(line)).toBe(false)
      selected.add(line)
    }
  }
  for (const chunk of evidence.chunks) {
    expect(chunk.text).toBe(rows.slice(chunk.firstLine - 1, chunk.lastLine).join(''))
    for (let line = chunk.firstLine; line <= chunk.lastLine; line++) expect(selected.has(line)).toBe(false)
  }
  for (const duplicate of evidence.exactDuplicateReferences) {
    const text = rows.slice(duplicate.duplicateFirstLine - 1, duplicate.duplicateLastLine).join('')
    expect(text).toBe(rows.slice(duplicate.originalFirstLine - 1, duplicate.originalLastLine).join(''))
    expect(duplicate.exactTextEqual).toBe(true)
  }
}
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  const failures: unknown[] = []
  for (const cleanup of cleanups.splice(0).reverse()) {
    try { await cleanup() } catch (error) { failures.push(error) }
  }
  vi.restoreAllMocks()
  if (failures.length > 0) throw new AggregateError(failures, 'Output integration cleanup failed')
})

async function localJev(answer?: (wire: FixtureWire) => object | Promise<object>) {
  const received: FixtureWire[] = []
  const server: Server = createServer(async (request, response) => {
    const parts: Buffer[] = []
    for await (const part of request) parts.push(Buffer.from(part))
    const wire = JSON.parse(Buffer.concat(parts).toString()) as FixtureWire
    received.push(wire)
    const answers = await answer?.(wire) ?? Object.fromEntries(Object.keys(wire.questions).map(id => [id, {
      choice: 'omit', probabilities: { omit: 0.95, keep: 0.03, unknown: 0.02 },
    }]))
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ answers }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Local fixture has no port')
  return { url: `http://127.0.0.1:${address.port}/v1/systemone`, received }
}

class FixturePtcRuntime extends PtcRuntime {
  readonly language = 'typescript'
  readonly isolation = 'test'
  innerValue: unknown
  resolve(request: PtcRunRequest): PtcRunSpec {
    return { ...request, cwd: request.cwd ?? process.cwd(), timeoutMs: request.timeoutMs ?? 120_000 }
  }
  async run(request: PtcRunRequest): Promise<PtcRunResult> {
    this.innerValue = await request.bindings[0]!.functions.bash!({ command: 'fixture build', description: 'Build fixture' })
    return { logs: [rawLog], value: { result: 'PROGRAM_RESULT_UNCHANGED' } }
  }
}

interface HarnessOptions {
  enabled?: boolean
  ptc?: boolean
  maxInlineTokens?: number
  answer?: (wire: FixtureWire) => object | Promise<object>
  beforeAdmission?: (ctx: Context) => void
  realBashExit?: number
  log?: string
  script?: ModelEntry[]
  failSpill?: boolean
  admissionConfig?: { maxRequestChars?: number }
}

async function harness(options: HarnessOptions = {}) {
  const log = options.log ?? rawLog
  const root = await mkdtemp(join(tmpdir(), 'jev-output-integration-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const http = await localJev(options.answer)
  const ctx = new Context()
  cleanups.push(async () => { await ctx.fiber.dispose() })
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true, ...options.ptc ? { tools: { mode: 'ptc' } } : {} })
  if (options.ptc) await ctx.plugin(FixturePtcRuntime)
  await ctx.plugin(Storage)
  await ctx.plugin(GoalService)
  await ctx.plugin(UserQuestions)
  await ctx.plugin(JsonlPersistence, { root: join(root, 'sessions') })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Subagents)
  ctx.storage.backend.register('json', new JsonStorageBackend(join(root, 'storage')))
  ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'json' }))
  ctx.provide('profileContext', { dir: join(root, 'profile') } as never)
  ctx.provide('settings', { configure: () => () => {} } as never)
  ctx.provide('credentials', { resolve: async () => ({ value: 'localhost-fixture', source: 'fixture' }) } as never)
  let calls = 0
  if (options.realBashExit !== undefined) {
    const exitCode = options.realBashExit
    const silent = { readFrom: (offset: number) => ({ text: '', nextOffset: offset, lossy: false }) }
    ctx.provide('shellEnv', { collect: () => ({}) } as never)
    ctx.provide('shell', {
      sandboxMode: undefined,
      resolve: (request: { command: string; workdir?: string; timeoutMs?: number }) => ({
        command: request.command, workdir: request.workdir ?? root,
        stdoutMaxBytes: 64_000, timeoutMs: request.timeoutMs ?? 120_000, onExpiry: 'kill',
      }),
      execute: async (spec: { timeoutMs: number }) => {
        calls++
        return {
          status: 'completed', exitCode, signal: null, done: Promise.resolve(),
          readOutput: () => ({ delta: '', lossy: false }),
          observed: { stdout: silent, stderr: silent }, kill: () => false,
          result: async () => ({
            exitCode, signal: null, timedOut: false, aborted: false, timeoutMs: spec.timeoutMs,
            stdout: { text: log, truncated: false }, stderr: { text: '', truncated: false },
          }),
        }
      },
    } as never)
  }
  const saves: Save[] = []
  const savePaths: string[] = []
  let spillAttempts = 0
  ctx.provide('spillStore', { saveText: async (input: Save) => {
    spillAttempts++
    if (options.failSpill) throw new Error('Fixture spill storage unavailable')
    saves.push(input)
    const locator = join(root, 'spill', `${saves.length}.txt`)
    await mkdir(join(root, 'spill'), { recursive: true })
    await writeFile(locator, input.content)
    savePaths.push(locator)
    return { locator, bytes: Buffer.byteLength(input.content), retrievalHint: 'Read the fixture spill path.' }
  } } as never)
  await ctx.plugin(JevService, {
    baseUrl: http.url, model: 'fixture-judge', credentialRef: 'FIXTURE_KEY', timeoutMs: 10_000,
    features: options.enabled ? { 'output-admission': true, 'test-log-admission': true } : {},
  })
  options.beforeAdmission?.(ctx)
  await ctx.plugin(SpillPolicy, { maxInlineTokens: options.maxInlineTokens })
  await ctx.plugin(outputAdmission, options.admissionConfig ?? {})
  if (options.realBashExit !== undefined) await ctx.plugin(ToolBash, { enableRunInBackground: false })
  const model = new Model(options.script ?? [call(options.ptc ? 'run_code' : 'bash', options.ptc
    ? { code: 'return await tools.bash({ command: "fixture build", description: "Build fixture" })', description: 'Build fixture' }
    : { command: 'fixture build', description: 'Build fixture' }), text('Fixture complete')])
  ctx.llm.registerAdapter(['fixture'], model)
  if (options.realBashExit === undefined) ctx.tools.register(defineTool({
    name: 'bash', description: 'Fixture bash tool',
    parameters: { command: { type: 'string', required: true }, description: { type: 'string', required: true } },
    output: { schema: { type: 'object', additionalProperties: true }, render: () => [{ type: 'text', text: log }] },
    async execute() {
      calls++
      return {
        kind: 'foreground', exitCode: 0, signal: null, timedOut: false, aborted: false, timeoutMs: 120_000,
        stdout: { text: log, truncated: false }, stderr: { text: '', truncated: false },
      }
    },
  }))
  const agent = await ctx.agentLoop.create(SessionId('jev-output-integration'), { provider: 'fixture', model: 'fixture' }, { cwd: root })
  const run = async () => {
    agent.followup(user('Build the fixture and summarize the result.'))
    await agent.whenIdle()
  }
  return { ctx, agent, model, run, calls: () => calls, saves, savePaths, spillAttempts: () => spillAttempts,
    received: http.received, root,
    runtime: options.ptc ? ctx.ptcRuntime as FixturePtcRuntime : undefined }
}

describe('output admission through published DSH paths', () => {
  it('keeps the original result and sends no Jev request when both switches are off', async () => {
    const h = await harness()
    await h.run()
    expect(h.calls()).toBe(1)
    expect(h.received).toHaveLength(0)
    const result = h.agent.session.snapshotEvents().find(event => event.type === 'tool/result')
    if (result?.type !== 'tool/result') throw new Error('No durable tool result')
    expect(contentText(result.data.message.content)).toBe(rawLog)
    expect(requestToolText(h.model.requests[1])).toBe(rawLog)
  })

  it('keeps a prior direct request for the complete log when the user says continue', async () => {
    const h = await harness({ enabled: true, script: [text('I will run the build next.'),
      call('bash', { command: 'fixture build', description: 'Build fixture' }), text('Fixture complete')] })
    h.agent.followup(user('Show me the complete verbatim build log.'))
    await h.agent.whenIdle()
    h.agent.followup(user('Continue.'))
    await h.agent.whenIdle()
    expect(h.calls()).toBe(1)
    expect(h.received).toHaveLength(0)
    expect(h.saves).toHaveLength(0)
    const result = h.agent.session.snapshotEvents().find(event => event.type === 'tool/result')
    if (result?.type !== 'tool/result') throw new Error('No durable tool result')
    expect(contentText(result.data.message.content)).toBe(rawLog)
    expect(requestToolText(h.model.requests[2])).toBe(rawLog)
  })

  it('records the admitted Native result once and presents that same content to the next model request', async () => {
    const h = await harness({ enabled: true, realBashExit: 0 })
    await h.run()
    expect(h.calls()).toBe(1)
    expect(h.received).toHaveLength(1)
    assertEvidenceMatches(rawLog, h.received[0]!)
    expect(h.received[0]!.state.retainedEvidence?.chunks.some(chunk => chunk.text.includes('DISTINCT EVIDENCE: package complete'))).toBe(true)
    const result = h.agent.session.snapshotEvents().filter(event => event.type === 'tool/result')
    expect(result).toHaveLength(1)
    if (result[0]?.type !== 'tool/result') throw new Error('No durable tool result')
    const delivered = contentText(result[0].data.message.content)
    expect(delivered).toContain('DISTINCT EVIDENCE: package complete')
    expect(delivered.length).toBeLessThan(rawLog.length)
    expect(requestToolText(h.model.requests[1])).toBe(delivered)
    expect(h.saves[0]?.content).toBe(rawLog)
    expect(await readFile(h.savePaths[0]!, 'utf8')).toBe(rawLog)
    await h.ctx.sessionPersistence.flush()
    const reader = await h.ctx.sessionPersistence.open(h.agent.id, 'read')
    const persisted = await reader.read()
    await reader.close()
    expect(persisted.events.filter(event => event.type === 'tool/result')).toEqual(result)
  })

  it('selects the test-log branch for a long passing runner result and keeps its summary', async () => {
    const h = await harness({ enabled: true, log: passingLog })
    await h.run()
    expect(h.received).toHaveLength(1)
    assertEvidenceMatches(passingLog, h.received[0]!)
    expect(h.received[0]!.state.retainedEvidence?.chunks.some(chunk => chunk.text.includes('Tests 180 passed'))).toBe(true)
    expect(JSON.stringify(h.received[0])).toContain('test-log-admission')
    const result = h.agent.session.snapshotEvents().find(event => event.type === 'tool/result')
    if (result?.type !== 'tool/result') throw new Error('No durable tool result')
    const delivered = contentText(result.data.message.content)
    expect(delivered).toContain('Tests 180 passed')
    expect(delivered).toContain('Jev omitted')
    expect(delivered.length).toBeLessThan(passingLog.length)
    expect(requestToolText(h.model.requests[1])).toBe(delivered)
    expect(await readFile(h.savePaths[0]!, 'utf8')).toBe(passingLog)
  })

  it('keeps the three unique fastest test results when Jev keeps their candidate groups', async () => {
    const h = await harness({ enabled: true, log: timedLog,
      script: [call('bash', { command: 'pnpm test', description: 'Run fixture tests' }), text('Fixture complete')],
      answer: wire => Object.fromEntries(Object.keys(wire.questions).map(id => {
        const candidate = wire.state.candidates.find(item => item.id === id)
        const required = candidate !== undefined && fastest.some(index => candidate.text.includes(`case-${index}.test.ts`))
        return [id, { choice: required ? 'keep' : 'omit', probabilities: required
          ? { omit: 0.01, keep: 0.98, unknown: 0.01 }
          : { omit: 0.98, keep: 0.01, unknown: 0.01 } }]
      })),
    })
    h.agent.followup(user('Find the three shortest test cases and give each exact duration.'))
    await h.agent.whenIdle()
    expect(h.received).toHaveLength(1)
    assertEvidenceMatches(timedLog, h.received[0]!)
    const result = h.agent.session.snapshotEvents().find(event => event.type === 'tool/result')
    if (result?.type !== 'tool/result') throw new Error('No durable tool result')
    const delivered = contentText(result.data.message.content)
    for (const [order, index] of fastest.entries()) {
      expect(delivered).toContain(`case-${index}.test.ts > handles scenario ${index} (${order + 1}ms)`)
    }
    expect(delivered).toContain('Tests 180 passed')
    expect(delivered.length).toBeLessThan(timedLog.length)
    expect(requestToolText(h.model.requests[1])).toBe(delivered)
  })

  it('asks no Jev question when the runner has no summary or other retained result evidence', async () => {
    const withoutSummary = passingLog.replace('PASS fixture.test.ts', 'PASS isolated-runner.test.ts')
      .replace('Tests 180 passed\n', '')
    const h = await harness({ enabled: true, log: withoutSummary,
      script: [call('bash', { command: 'pnpm test', description: 'Run fixture tests' }), text('Fixture complete')] })
    h.agent.followup(user('Report the overall pass or fail result of this test run.'))
    await h.agent.whenIdle()
    expect(h.received).toHaveLength(0)
    const result = h.agent.session.snapshotEvents().find(event => event.type === 'tool/result')
    if (result?.type !== 'tool/result') throw new Error('No durable tool result')
    expect(contentText(result.data.message.content)).toBe(withoutSummary)
    expect(requestToolText(h.model.requests[1])).toBe(withoutSummary)
  })

  it('retains unshown candidate lines when the request budget removes candidates', async () => {
    const h = await harness({ enabled: true, admissionConfig: { maxRequestChars: 6000 } })
    await h.run()
    expect(h.received).toHaveLength(1)
    const wire = h.received[0]!
    assertEvidenceMatches(rawLog, wire)
    const unshown = wire.state.retainedEvidence?.unshownRetainedCandidates ?? []
    expect(unshown.length).toBeGreaterThan(0)
    expect(wire.state.candidates.length).toBeGreaterThan(0)
    const result = h.agent.session.snapshotEvents().find(event => event.type === 'tool/result')
    if (result?.type !== 'tool/result') throw new Error('No durable tool result')
    const delivered = contentText(result.data.message.content)
    const lines = sourceLines(rawLog)
    for (const span of unshown) expect(delivered).toContain(lines.slice(span.firstLine - 1, span.lastLine).join(''))
    expect(requestToolText(h.model.requests[1])).toBe(delivered)
  })

  it('sends no Jev request when necessary retained evidence cannot fit the request budget', async () => {
    const h = await harness({ enabled: true, admissionConfig: { maxRequestChars: 128 } })
    await h.run()
    expect(h.received).toHaveLength(0)
    const result = h.agent.session.snapshotEvents().find(event => event.type === 'tool/result')
    if (result?.type !== 'tool/result') throw new Error('No durable tool result')
    expect(contentText(result.data.message.content)).toBe(rawLog)
  })

  it('lets native spill bound the already-admitted text', async () => {
    const h = await harness({ enabled: true, maxInlineTokens: 100 })
    await h.run()
    expect(h.received).toHaveLength(1)
    expect(h.saves).toHaveLength(2)
    expect(h.saves[0]?.content).toBe(rawLog)
    expect(h.saves[1]?.content.length).toBeLessThan(rawLog.length)
    const result = h.agent.session.snapshotEvents().find(event => event.type === 'tool/result')
    expect(JSON.stringify(result)).toContain(h.savePaths[1]!)
    expect(requestToolText(h.model.requests[1])).toContain(h.savePaths[1]!)
    expect(await readFile(h.savePaths[1]!, 'utf8')).toBe(h.saves[1]!.content)
  })

  it('passes the complete result onward when Jev original storage fails', async () => {
    const h = await harness({ enabled: true, failSpill: true })
    await h.run()
    expect(h.received).toHaveLength(1)
    expect(h.spillAttempts()).toBe(1)
    expect(h.saves).toHaveLength(0)
    const result = h.agent.session.snapshotEvents().find(event => event.type === 'tool/result')
    if (result?.type !== 'tool/result') throw new Error('No durable tool result')
    expect(contentText(result.data.message.content)).toBe(rawLog)
    expect(requestToolText(h.model.requests[1])).toBe(rawLog)
  })

  it('ends an unanswered Jev decision at the four-second budget and records the cancellation', async () => {
    const release = Promise.withResolvers<object>()
    cleanups.push(async () => { release.resolve({}) })
    const h = await harness({ enabled: true, answer: () => release.promise })
    const started = performance.now()
    await h.run()
    const elapsed = performance.now() - started
    expect(elapsed).toBeGreaterThanOrEqual(3800)
    expect(h.received).toHaveLength(1)
    expect(h.model.requests).toHaveLength(2)
    expect(h.saves).toHaveLength(0)
    const result = h.agent.session.snapshotEvents().find(event => event.type === 'tool/result')
    if (result?.type !== 'tool/result') throw new Error('No durable tool result')
    expect(contentText(result.data.message.content)).toBe(rawLog)
    expect(requestToolText(h.model.requests[1])).toBe(rawLog)
    const records = await h.ctx.jev.listRecords({ featureId: 'output-admission', sessionId: h.agent.id })
    expect(records.items).toHaveLength(1)
    expect(records.items[0]?.status).toBe('cancelled')
    const detail = await h.ctx.jev.getRecord(records.items[0]!.id)
    expect(detail?.failure).toMatchObject({ code: 'ADMISSION_TIMEOUT' })
    expect(detail?.failure?.message).toContain('original tool result')
    release.resolve({ answers: {} })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(h.agent.session.snapshotEvents().filter(event => event.type === 'tool/result')).toHaveLength(1)
  }, 10_000)

  it('leaves another post-execute policy block authoritative', async () => {
    const h = await harness({ enabled: true, beforeAdmission: ctx => {
      ctx.on('tools/post-execute', async (exec, _result, next) => exec.name === 'bash'
        ? { kind: 'block', feedback: [{ type: 'text', text: 'Fixture policy denied the result' }] }
        : next())
    } })
    await h.run()
    expect(h.calls()).toBe(1)
    expect(h.received).toHaveLength(0)
    expect(h.saves).toHaveLength(0)
    const result = h.agent.session.snapshotEvents().find(event => event.type === 'tool/result')
    if (result?.type !== 'tool/result') throw new Error('No durable tool result')
    expect(result.data.message.isError).toBe(true)
    expect(contentText(result.data.message.content)).toBe('Fixture policy denied the result')
    expect(requestToolText(h.model.requests[1])).toBe('Fixture policy denied the result')
  })

  it('retains the published bash renderer exit marker and full failure log when exitCode is nonzero', async () => {
    const h = await harness({ enabled: true, realBashExit: 1 })
    await h.run()
    expect(h.calls()).toBe(1)
    expect(h.received).toHaveLength(0)
    const result = h.agent.session.snapshotEvents().find(event => event.type === 'tool/result')
    if (result?.type !== 'tool/result') throw new Error('No durable tool result')
    expect(result.data.message.isError).toBe(false)
    const delivered = contentText(result.data.message.content)
    expect(delivered).toBe(`${rawLog}[exit code: 1]`)
    expect(requestToolText(h.model.requests[1])).toBe(delivered)
  })

  it('filters only the PTC outer logs while preserving the program value and result display', async () => {
    const h = await harness({ enabled: true, ptc: true })
    await h.run()
    expect(h.calls()).toBe(1)
    expect(h.received).toHaveLength(1)
    assertEvidenceMatches(rawLog, h.received[0]!)
    expect(h.received[0]!.state.outerResultSuffix).toMatchObject({ source: 'run_code-rendered-result-after-logs' })
    expect(h.saves[0]?.content).toBe(rawLog + h.received[0]!.state.outerResultSuffix?.text)
    expect(h.runtime?.innerValue).toMatchObject({ kind: 'foreground', stdout: { text: rawLog } })
    const result = h.agent.session.snapshotEvents().find(event => event.type === 'tool/result')
    if (result?.type !== 'tool/result') throw new Error('No durable tool result')
    const delivered = contentText(result.data.message.content)
    expect(delivered).toContain('PROGRAM_RESULT_UNCHANGED')
    expect(delivered).not.toContain(progress)
    expect(requestToolText(h.model.requests[1])).toBe(delivered)
    expect(h.saves[0]?.content).toContain(rawLog)
    expect(h.saves[0]?.content).toContain('PROGRAM_RESULT_UNCHANGED')
    expect(await readFile(h.savePaths[0]!, 'utf8')).toBe(h.saves[0]!.content)
  })

  it('skips an entered child Agent while the root feature is enabled', async () => {
    const h = await harness({ enabled: true })
    const id = SessionId('jev-output-child')
    const session = h.ctx.sessions.create(id, { meta: { cwd: h.root } })
    const child = { ...h.agent, id, session, status: 'running' } as Agent
    const detach = h.ctx.agents.enter(child, h.agent)
    cleanups.push(async () => { detach() })
    const result = await h.ctx.tools.execute({
      name: 'bash', arguments: { command: 'fixture build', description: 'Build fixture' },
      agent: child, signal: new AbortController().signal, callId: ToolCallId('output-child-call'),
    })
    expect(result.isError).toBe(false)
    expect(contentText(result.content)).toBe(rawLog)
    expect(h.received).toHaveLength(0)
    expect(h.saves).toHaveLength(0)
  })

  it('does not deliver a late judgment after the Agent is stopped', async () => {
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    cleanups.push(async () => { release.resolve() })
    const h = await harness({ enabled: true, answer: async wire => {
      started.resolve()
      await release.promise
      return Object.fromEntries(Object.keys(wire.questions).map(id => [id, {
        choice: 'omit', probabilities: { omit: 0.99, keep: 0.005, unknown: 0.005 },
      }]))
    } })
    h.agent.followup(user('Build the fixture and summarize the result.'))
    await started.promise
    h.agent.cancel({ kind: 'user' })
    release.resolve()
    await h.agent.whenIdle()
    expect(h.calls()).toBe(1)
    expect(h.model.requests).toHaveLength(1)
    expect(h.saves).toHaveLength(0)
    expect(h.agent.session.snapshotEvents().filter(event => event.type === 'tool/result')
      .every(event => !JSON.stringify(event).includes('Jev omitted'))).toBe(true)
  })
})
