/** Combined public AgentLoop hooks with deterministic localhost judgments and a scripted main model. */
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import GoalService from '@deepseek-ai/dsh-goal'
import { createUserMessage, LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Subagents from '@deepseek-ai/dsh-subagent'
import Storage from '@deepseek-ai/dsh-storage'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { defineTool } from '@deepseek-ai/dsh-tools'
import UserQuestions from '@deepseek-ai/dsh-user-questions'
import JevService from '../src/index.ts'
import * as instructions from '../src/instructions.ts'
import * as supervision from '../src/supervision.ts'
import * as sharedFindings from '../src/shared-findings.ts'
import * as interjection from '../src/interjection.ts'

interface Wire {
  state: { mode?: string; operation?: { name: string }; sources?: { id: string; text: string }[] }
  questions: Record<string, { criteria: Record<string, unknown> }>
}
type ModelEntry = StreamChunk[] | (() => Promise<StreamChunk[]>)
class Model extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  constructor(private readonly entries: ModelEntry[]) { super() }
  async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(request)
    const entry = this.entries.shift()
    if (entry === undefined) throw new Error('Integration model script exhausted')
    yield* typeof entry === 'function' ? await entry() : entry
  }
}
const text = (value: string): StreamChunk[] => [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'block-end', index: 0, block: { type: 'text', text: value } },
  { type: 'finish', reason: { kind: 'stop' } },
]
const call = (id: string, name: string, args: object = {}): StreamChunk[] => [
  { type: 'block-start', index: 0, blockType: 'tool-call' },
  { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId(id), name, arguments: JSON.stringify(args) } },
  { type: 'finish', reason: { kind: 'tool-calls' } },
]
const user = (value: string) => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: value }] })
const featureIds = ['instruction-guidance', 'interjection-routing', 'shared-findings', 'drift-monitoring', 'completion-check', 'goal-supervision']
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  const failures: unknown[] = []
  for (const cleanup of cleanups.splice(0).reverse()) { try { await cleanup() } catch (error) { failures.push(error) } }
  vi.restoreAllMocks()
  if (failures.length) throw new AggregateError(failures, 'Integration cleanup failed')
})

async function fixture(script: ModelEntry[], options: { enabled?: boolean; supplement?: boolean; holdInstructions?: Promise<void> } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'jev-combined-hooks-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  await mkdir(join(dir, '.git'))
  await mkdir(join(dir, 'home'))
  await writeFile(join(dir, 'TEAM.md'), 'Only modify plan.md. Other files require a changed user requirement.\n')
  const requests: Wire[] = []
  let completion = 0
  const server = createServer(async (request, response) => {
    const parts: Buffer[] = []
    for await (const chunk of request) parts.push(Buffer.from(chunk))
    const wire = JSON.parse(Buffer.concat(parts).toString()) as Wire
    requests.push(wire)
    const answers: Record<string, { choice: string }> = {}
    if (wire.questions.route !== undefined) answers.route = { choice: 'correction' }
    else if (wire.questions.assessment !== undefined) {
      answers.assessment = { choice: wire.state.mode === 'completion'
        ? options.supplement && completion++ === 0 ? 'omission' : 'complete'
        : 'on-track' }
      answers.evidence = { choice: Object.keys(wire.questions.evidence!.criteria)[0]! }
    } else {
      await options.holdInstructions
      for (const id of Object.keys(wire.questions)) {
        const source = wire.state.sources?.find(item => item.id === id)
        answers[id] = { choice: id === 'no-requirements' ? 'not-applicable'
          : wire.state.operation?.name === 'write' && source?.text.includes('Only modify plan.md') ? 'conflict' : 'no-conflict' }
      }
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ answers }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Fixture has no loopback port')
  const ctx = new Context()
  cleanups.push(async () => { await ctx.fiber.dispose() })
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(LocalFileSystem, { cwd: dir })
  await ctx.plugin(WorkingDirectory)
  await ctx.plugin(Storage)
  await ctx.plugin(GoalService)
  await ctx.plugin(UserQuestions)
  await ctx.plugin(JsonlPersistence, { root: join(dir, 'sessions') })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Subagents)
  ctx.storage.backend.register('json', new JsonStorageBackend(join(dir, 'storage')))
  ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'json' }))
  ctx.provide('profileContext', { dir: join(dir, 'profile') } as never)
  ctx.provide('settings', { configure: () => () => {} } as never)
  ctx.provide('credentials', { resolve: async () => ({ value: 'localhost-only-fixture', source: 'fixture' }) } as never)
  ctx.provide('loader', { entries: () => [{ options: { name: '@deepseek-ai/dsh-agent-instructions' }, fiber: { state: 2, uid: 1, ctx,
    config: { dshHome: join(dir, 'home'), maxBytes: 24_000, instructionFileCandidates: ['TEAM.md'], localInstructionFileCandidates: [], projectRootMarkers: ['.git'] } } }] } as never)
  await ctx.plugin(JevService, { baseUrl: `http://127.0.0.1:${address.port}/v1/systemone`, model: 'fixture-judge', credentialRef: 'FIXTURE_KEY', timeoutMs: 10_000,
    features: options.enabled ? Object.fromEntries(featureIds.map(id => [id, true])) : {} })
  const instructionCalls: Promise<unknown>[] = []
  const judgeOnce = ctx.jev.judgeOnce.bind(ctx.jev)
  vi.spyOn(ctx.jev, 'judgeOnce').mockImplementation(options => {
    const pending = judgeOnce(options)
    if (options.featureId === 'instruction-guidance') instructionCalls.push(pending)
    return pending
  })
  await ctx.plugin(supervision, { driftInterval: 1 })
  await ctx.plugin(instructions)
  await ctx.plugin(sharedFindings)
  await ctx.plugin(interjection)
  const model = new Model(script)
  ctx.llm.registerAdapter(['fixture'], model)
  let writes = 0
  ctx.tools.register(defineTool({ name: 'write', description: 'Write a fixture file through the original pipeline',
    parameters: { file_path: { type: 'string', required: true }, content: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) { writes++; await writeFile(join(dir, args.file_path), args.content); return 'fixture file written' } }))
  ctx.tools.register(defineTool({ name: 'probe', description: 'Return deterministic verification evidence', parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute: async () => 'fixture probe returned' }))
  const errors: unknown[] = []
  const asks: string[] = []
  ctx.on('agent/error', ({ error }) => { errors.push(error) })
  ctx.on('user-questions/request', async request => {
    asks.push(request.agent?.id ?? 'no-agent')
    return { answers: [{ id: 'jev-resolution', selected: ['取消 / Cancel'] }] }
  })
  const agent = await ctx.agentLoop.create(SessionId('combined-hooks'), { provider: 'fixture', model: 'fixture' }, { cwd: dir })
  return { ctx, agent, model, requests, errors, asks, instructionCalls, dir, writes: () => writes,
    send: (value: string) => agent.followup(user(value)),
    messages: () => agent.session.deriveMessages(),
    records: () => ctx.jev.listRecords({ sessionId: agent.id, limit: 100 }),
  }
}

it('keeps the original tool and answer path with every combined feature disabled', async () => {
  const h = await fixture([call('original-tool', 'probe'), text('Original answer')])
  expect((await h.ctx.jev.listFeatures()).map(feature => feature.id).sort()).toEqual([...featureIds].sort())
  expect((await h.ctx.jev.listFeatures()).every(feature => !feature.enabled)).toBe(true)
  const original = user('Complete the original request')
  h.agent.followup(original)
  await h.agent.whenIdle()
  expect(h.errors).toEqual([])
  expect(h.requests).toHaveLength(0)
  expect(h.model.requests).toHaveLength(2)
  expect(h.messages().filter(message => message.id === original.id)).toHaveLength(1)
  expect(h.agent.session.snapshotEvents().filter(event => event.type === 'tool/result')).toHaveLength(1)
  expect(JSON.stringify(h.messages())).toContain('Original answer')
})

it('delivers a classified correction once while completion checking performs only one supplement', async () => {
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const h = await fixture([async () => { started.resolve(); await release.promise; return call('probe-original', 'probe') },
    text('Original answer after correction'), text('Supplement completed')], { enabled: true, supplement: true })
  cleanups.push(async () => { release.resolve() })
  h.send('Implement and verify the requested result')
  await started.promise
  const correction = user('Correction: preserve the original entry point while completing the verification.')
  h.agent.followup(correction)
  await vi.waitFor(async () => {
    const record = (await h.records()).items.find(item => item.featureId === 'interjection-routing')
    expect(record?.status).toBe('succeeded')
  })
  release.resolve()
  await h.agent.whenIdle()
  expect(h.errors).toEqual([])
  expect(h.asks).toEqual([])
  expect(h.requests.filter(request => request.questions.route !== undefined)).toHaveLength(1)
  expect(h.messages().filter(message => message.role === 'user' && message.source.kind === 'user' && message.id === correction.id)).toHaveLength(1)
  expect(h.messages().filter(message => message.role === 'user' && message.source.kind === 'jev-supervision' && message.source.action === 'supplement')).toHaveLength(1)
  expect(h.model.requests).toHaveLength(3)
  const details = await Promise.all((await h.records()).items.map(item => h.ctx.jev.getRecord(item.id)))
  expect(details.filter(item => item?.receipts.some(receipt => receipt.id === 'supplement-reserved'))).toHaveLength(1)
  expect(h.requests.filter(request => request.state.mode === 'completion')).toHaveLength(2)
})

it('does not turn a pending instruction reminder into a tool or model barrier when supervision is also mounted', async () => {
  const instructionReply = Promise.withResolvers<void>()
  const secondModel = Promise.withResolvers<void>()
  const releaseSecond = Promise.withResolvers<void>()
  const h = await fixture([call('write-original', 'write', { file_path: 'product.txt', content: 'original operation completed' }),
    async () => { secondModel.resolve(); await releaseSecond.promise; return call('next-probe', 'probe') }, text('Finished')],
  { enabled: true, holdInstructions: instructionReply.promise })
  cleanups.push(async () => { instructionReply.resolve(); releaseSecond.resolve() })
  h.send('Carry out the requested project change and verification')
  await secondModel.promise
  await vi.waitFor(() => expect(h.requests.some(request => request.state.operation?.name === 'write')).toBe(true))
  expect(h.writes()).toBe(1)
  expect(await readFile(join(h.dir, 'product.txt'), 'utf8')).toBe('original operation completed')
  expect(h.model.requests).toHaveLength(2)
  expect(h.asks).toEqual([])
  instructionReply.resolve()
  await Promise.all(h.instructionCalls)
  releaseSecond.resolve()
  await h.agent.whenIdle()
  expect(h.errors).toEqual([])
  expect(h.asks).toEqual([])
  expect(h.model.requests).toHaveLength(3)
  const reminders = h.messages().filter(message => message.role === 'user' && message.source.kind === 'jev-instruction-guidance')
  expect(reminders).toHaveLength(1)
  expect(JSON.stringify(reminders[0])).toContain('Only modify plan.md')
  expect(h.requests.some(request => request.state.mode === 'drift')).toBe(true)
  expect(h.requests.filter(request => request.state.mode === 'completion')).toHaveLength(1)
})
