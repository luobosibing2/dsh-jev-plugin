/** Business effects through published DSH hooks and independent localhost Decisions responses. */
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import { createVolatile, updateVolatile } from '@deepseek-ai/cosmokit'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { SandboxedFileSystem } from '@deepseek-ai/dsh-fs-sandbox'
import GoalService from '@deepseek-ai/dsh-goal'
import { createUserMessage, LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import Storage from '@deepseek-ai/dsh-storage'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import Subagents from '@deepseek-ai/dsh-subagent'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import {
  applyGlobTool, GLOB_MAX_RESULTS, RAW_OUTPUT_MAX_BYTES, SEARCH_GRACE_MS,
  SEARCH_META_MAX_BYTES, SEARCH_STDERR_MAX_BYTES, SEARCH_TIMEOUT_MS,
} from '@deepseek-ai/dsh-tool-fs-search'
import { defineTool } from '@deepseek-ai/dsh-tools'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import UserQuestions from '@deepseek-ai/dsh-user-questions'
import JevService, { type Config as JevConfig } from '../src/index.ts'
import * as instructions from '../src/instructions.ts'
import * as outputAdmission from '../src/output-admission.ts'
import * as selection from '../src/selection.ts'
import * as workspaceApproval from '../src/workspace-approval.ts'
import type { JevLunaApi, Json } from '../src/types.ts'

interface NativeQuestion { name: string; type: string; instructions?: string }
interface ProviderBody {
  model: string
  state?: Json
  input?: string
  questions: Record<string, { type: string; instructions: Json }> | NativeQuestion[]
}
type ModelEntry = StreamChunk[] | (() => Promise<StreamChunk[]>)
class ScriptedModel extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  constructor(private readonly entries: ModelEntry[]) { super() }
  async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(request)
    const entry = this.entries.shift()
    if (entry === undefined) throw new Error('Business integration model script exhausted')
    yield* typeof entry === 'function' ? await entry() : entry
  }
}
const text = (value: string): StreamChunk[] => [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'block-end', index: 0, block: { type: 'text', text: value } },
  { type: 'finish', reason: { kind: 'stop' } },
]
const call = (id: string, name: string, args: object): StreamChunk[] => [
  { type: 'block-start', index: 0, blockType: 'tool-call' },
  { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId(id), name, arguments: JSON.stringify(args) } },
  { type: 'finish', reason: { kind: 'tool-calls' } },
]
const contentText = (blocks: readonly { type: string; text?: string }[]) => blocks.filter(block => block.type === 'text').map(block => block.text ?? '').join('')
const questionIds = (body: ProviderBody) => Array.isArray(body.questions)
  ? body.questions.map(question => question.name) : Object.keys(body.questions)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  const failures: unknown[] = []
  for (const cleanup of cleanups.splice(0).reverse()) {
    try { await cleanup() } catch (error) { failures.push(error) }
  }
  vi.restoreAllMocks()
  if (failures.length) throw new AggregateError(failures, 'Luna business integration cleanup failed')
})

async function fixture(api: JevLunaApi, script: ModelEntry[], features: Record<string, boolean>,
  reply: (body: ProviderBody) => object | Promise<object>, filesystem: 'local' | 'sandbox' = 'local') {
  const root = await mkdtemp(join(filesystem === 'sandbox' ? process.cwd() : tmpdir(), 'jev-luna-business-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  await mkdir(join(root, 'outside'))
  await mkdir(join(root, 'home'))
  await mkdir(join(workspace, '.git'))
  const received: ProviderBody[] = []
  const handlerErrors: unknown[] = []
  const server = createServer(async (request, response) => {
    try {
      const parts: Buffer[] = []
      for await (const part of request) parts.push(Buffer.from(part))
      const body = JSON.parse(Buffer.concat(parts).toString('utf8')) as ProviderBody
      received.push(body)
      expect(body.model).toBe(api === 'openai' ? 'gpt-6-luna' : 'openai/gpt-6-luna-decisions')
      expect(Array.isArray(body.questions)).toBe(api === 'openai')
      if (api === 'openai') {
        expect(typeof body.input).toBe('string')
        expect(body.state).toBeUndefined()
      } else {
        expect(body.state).toBeDefined()
        expect(body.input).toBeUndefined()
      }
      const answer = await reply(body)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(answer))
    } catch (error) {
      handlerErrors.push(error)
      response.writeHead(500, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'Local fixture failed' }))
    }
  })
  cleanups.push(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    expect(handlerErrors).toEqual([])
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Provider fixture has no loopback port')
  const url = `http://127.0.0.1:${address.port}/decision-fixture`
  const ctx = new Context()
  let disposeStorage: (() => Promise<void>) | undefined
  cleanups.push(async () => { try { await ctx.fiber.dispose() } finally { await disposeStorage?.() } })
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(WorkingDirectory)
  if (filesystem === 'sandbox') {
    await ctx.plugin(SandboxPolicy, { mode: 'workspace-write', workspaceRoot: workspace })
    await ctx.plugin(ApprovalService, { policy: 'ask' })
    await ctx.plugin(SandboxedFileSystem, { cwd: workspace })
    await ctx.plugin(ToolFs)
  } else await ctx.plugin(LocalFileSystem, { cwd: workspace })
  await ctx.plugin(Storage)
  await ctx.plugin(GoalService)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(UserQuestions)
  await ctx.plugin(JsonlPersistence, { root: join(root, 'sessions') })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Subagents)
  const backend = new JsonStorageBackend(join(root, 'storage'))
  const unregister = ctx.storage.backend.register('json', backend)
  const facility = new DomainFacility(ctx, { backend: 'json' })
  ctx.provide('storageDomain', facility)
  disposeStorage = async () => { await facility.closeAll(); unregister(); await backend.close() }
  ctx.provide('profileContext', { dir: join(root, 'profile') } as never)
  ctx.provide('settings', { configure: () => () => {} } as never)
  ctx.provide('credentials', { resolve: async () => ({ value: 'localhost-only-fixture', source: 'fixture' }) } as never)
  const fiber = await ctx.plugin(JevService, {
    baseUrl: url, model: 'original-jev-model', credentialRef: 'ORIGINAL_JEV_REF', timeoutMs: 10_000, features,
    judgmentModel: 'luna', lunaApi: api,
    lunaOpenRouterBaseUrl: url, lunaOpenRouterCredentialRef: 'FIXTURE_ROUTER_REF',
    lunaOpenAIBaseUrl: url, lunaOpenAICredentialRef: 'FIXTURE_OPENAI_REF',
  })
  const model = new ScriptedModel(script)
  ctx.llm.registerAdapter(['fixture'], model)
  const errors: unknown[] = []
  ctx.on('agent/error', ({ error }) => { errors.push(error) })
  const questions: unknown[] = []
  ctx.on('user-questions/request', async request => {
    questions.push(request)
    return { answers: [{ id: 'jev-resolution', selected: ['取消 / Cancel'] }] }
  })
  const agent = await ctx.agentLoop.create(SessionId('luna-business'), { provider: 'fixture', model: 'fixture-main' }, { cwd: workspace })
  const run = async (value: string) => {
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: value }] }))
    await agent.whenIdle()
    expect(errors).toEqual([])
  }
  const records = async (featureId: string) => Promise.all((await ctx.jev.listRecords({ featureId, limit: 100 })).items.map(item => ctx.jev.getRecord(item.id)))
  return { ctx, agent, model, received, questions, root, workspace, run, records, config: fiber.config as JevConfig }
}

function choiceReply(body: ProviderBody, choice: string, probabilities: Record<string, number>, invalidLast = false) {
  const ids = questionIds(body)
  if (Array.isArray(body.questions)) return {
    model: 'gpt-6-luna', usage: { input_tokens: 23, output_tokens: 7 },
    answers: ids.map((name, index) => invalidLast && index === ids.length - 1
      ? { type: 'refusal', name }
      : { type: 'choice', name, choice, confidence: 0.97,
        probabilities: Object.entries(probabilities).map(([value, probability]) => ({ value, probability })) }).reverse(),
  }
  return { model: 'openai/gpt-6-luna-decisions', usage: { input_tokens: 23, output_tokens: 7 },
    answers: Object.fromEntries(ids.map((id, index) => [id, {
      choice: invalidLast && index === ids.length - 1 ? 'unavailable-provider-option' : choice,
      probabilities, confidence: 0.97,
    }])) }
}
const rawLog = `Start fixture build\n${Array.from({ length: 500 }, (_, index) => `Building ${index + 1}/500\n`).join('')}DISTINCT EVIDENCE: package complete\nFinished fixture build\n`
const bashCall = (id: string) => call(id, 'bash', { command: 'fixture build', description: 'Build fixture' })
async function mountLogTool(ctx: Context) {
  ctx.tools.register(defineTool({ name: 'bash', description: 'Return the fixture build result',
    parameters: { command: { type: 'string', required: true }, description: { type: 'string', required: true } },
    output: { schema: { type: 'object', additionalProperties: true }, render: () => [{ type: 'text', text: rawLog }] },
    execute: async () => ({ kind: 'foreground', exitCode: 0, signal: null, timedOut: false, aborted: false,
      timeoutMs: 120_000, stdout: { text: rawLog, truncated: false }, stderr: { text: '', truncated: false } }),
  }))
}

describe.each(['openrouter', 'openai'] as const)('existing businesses with Luna %s', api => {
  it('ranks original glob paths by Noul probability and retains tie order and configured limits', async () => {
    const h = await fixture(api, [call('glob-original', 'glob', { pattern: '*.ts' }), text('Found the requested files')],
      { 'file-ranking': true, 'skill-selection': false }, body => {
        expect(questionIds(body)).toEqual(['candidate-0', 'candidate-1', 'candidate-2'])
        expect(Array.isArray(body.questions) ? body.questions.map(question => question.type)
          : Object.values(body.questions).map(question => question.type)).toEqual(Array(3).fill(api === 'openai' ? 'predicate' : 'noul'))
        return Array.isArray(body.questions)
          ? { answers: [{ type: 'predicate', name: 'candidate-2', probability: 0.9 },
            { type: 'predicate', name: 'candidate-0', probability: 0.1 }, { type: 'predicate', name: 'candidate-1', probability: 0.9 }] }
          : { answers: { 'candidate-0': { noul: 0.1 }, 'candidate-1': { noul: 0.9 }, 'candidate-2': { noul: 0.9 } } }
      })
    let scans = 0
    h.ctx.provide('subprocess', { spawn: () => {
      scans++
      return { done: Promise.resolve({ exitCode: 0, signal: null }), collected: {
        stdout: { readFrom: () => ({ text: 'b.ts\na.ts\nc.ts\n', lossy: false }) },
        stderr: { readFrom: () => ({ text: '', lossy: false }) },
      } }
    } } as never)
    const spills: string[] = []
    h.ctx.provide('spillStore', { saveText: async ({ content }: { content: string }) => {
      spills.push(content)
      return { locator: 'spill://ranked-fixture', bytes: content.length, retrievalHint: 'Read the complete ranking.' }
    } } as never)
    applyGlobTool(h.ctx, { sampleOverCapGlobResults: false, maxResults: GLOB_MAX_RESULTS, maxMetaBytes: SEARCH_META_MAX_BYTES,
      rawOutputMaxBytes: RAW_OUTPUT_MAX_BYTES, graceMs: SEARCH_GRACE_MS, stderrMaxBytes: SEARCH_STDERR_MAX_BYTES, timeoutMs: SEARCH_TIMEOUT_MS })
    const limits = await h.ctx.plugin(selection, { skillLimit: 7, fileCandidates: 3, fileLimit: 2 })
    const values: unknown[] = []
    h.ctx.on('tools/result', (exec, result) => { if (exec.name === 'glob') values.push(result.value) })
    await h.run('Find the relevant TypeScript files')
    expect(scans).toBe(1)
    expect(h.received).toHaveLength(1)
    expect(h.received[0]?.model).toBe(api === 'openai' ? 'gpt-6-luna' : 'openai/gpt-6-luna-decisions')
    const result = h.agent.session.snapshotEvents().find(event => event.type === 'tool/result')
    if (result?.type !== 'tool/result') throw new Error('Glob produced no Session result')
    expect(values).toEqual([{ root: '.', paths: ['a.ts', 'c.ts', 'b.ts'] }])
    const delivered = contentText(result.data.message.content)
    expect(delivered.indexOf('a.ts')).toBeLessThan(delivered.indexOf('c.ts'))
    expect(delivered).not.toContain('b.ts')
    expect(delivered).toContain('showing 2')
    expect(spills[0]?.indexOf('c.ts')).toBeLessThan(spills[0]!.indexOf('b.ts'))
    expect(contentText(h.model.requests[1]!.messages.find(message => message.role === 'tool')!.content)).toBe(delivered)
    expect([limits.config.skillLimit.get(), limits.config.fileCandidates.get(), limits.config.fileLimit.get()]).toEqual([7, 3, 2])
    expect(h.ctx.jev.isFeatureEnabled('skill-selection')).toBe(false)
    const record = (await h.records('file-ranking'))[0]!
    expect(record?.receipts).toContainEqual(expect.objectContaining({ id: 'glob-paths-ranked', status: 'observed' }))
    expect(record?.attemptRecords[0]?.connection.connectionId).toBe(`luna-${api}`)
    expect(record?.attemptRecords[0]?.response?.answers.map(answer => answer.confidence)).toEqual([undefined, undefined, undefined])
  })

  it('keeps a saved omission threshold and disabled feature when switching the judgment model', async () => {
    let omit = 0.85
    const h = await fixture(api, [bashCall('below-threshold'), text('First build done'), bashCall('above-threshold'), text('Second build done')],
      { 'output-admission': true, 'test-log-admission': false, 'skill-selection': false }, body =>
        choiceReply(body, 'omit', { omit, keep: 1 - omit, unknown: 0 }))
    const saves: string[] = []
    h.ctx.provide('spillStore', { saveText: async ({ content }: { content: string }) => {
      saves.push(content)
      const locator = join(h.root, 'original-log.txt')
      await writeFile(locator, content)
      return { locator, bytes: Buffer.byteLength(content), retrievalHint: 'Read the original log.' }
    } } as never)
    const admission = await h.ctx.plugin(outputAdmission)
    updateVolatile(admission.config.omitProbability, createVolatile(0.9))
    await mountLogTool(h.ctx)
    await h.run('Build the fixture and summarize the result')
    const first = h.agent.session.snapshotEvents().filter(event => event.type === 'tool/result')[0]!
    if (first.type !== 'tool/result') throw new Error('First build has no Session result')
    expect(contentText(first.data.message.content)).toBe(rawLog)
    expect(saves).toEqual([])
    updateVolatile(h.config.judgmentModel, createVolatile('jev'))
    updateVolatile(h.config.judgmentModel, createVolatile('luna'))
    expect(h.received).toHaveLength(1)
    expect(h.config.model.get()).toBe('original-jev-model')
    expect(h.config.credentialRef.get()).toBe('ORIGINAL_JEV_REF')
    omit = 0.98
    await h.run('Build the fixture again and summarize the result')
    const second = h.agent.session.snapshotEvents().filter(event => event.type === 'tool/result')[1]!
    if (second.type !== 'tool/result') throw new Error('Second build has no Session result')
    const delivered = contentText(second.data.message.content)
    expect(delivered).toContain('DISTINCT EVIDENCE: package complete')
    expect(delivered).toContain('Jev omitted')
    expect(delivered.length).toBeLessThan(rawLog.length)
    expect(contentText(h.model.requests[3]!.messages.filter(message => message.role === 'tool').at(-1)!.content)).toBe(delivered)
    expect(saves).toEqual([rawLog])
    expect(await readFile(join(h.root, 'original-log.txt'), 'utf8')).toBe(rawLog)
    expect(admission.config.omitProbability.get()).toBe(0.9)
    expect(h.ctx.jev.isFeatureEnabled('skill-selection')).toBe(false)
    expect(h.ctx.jev.isFeatureEnabled('test-log-admission')).toBe(false)
    expect(h.received).toHaveLength(2)
    expect(h.questions).toEqual([])
    await vi.waitFor(async () => expect((await h.records('output-admission')).some(record =>
      record?.receipts.some(receipt => receipt.id === 'tool-log-final-result' && receipt.status === 'observed'))).toBe(true))
  })

  it('retains the complete log when one of several Choice answers refuses or selects an invalid option', async () => {
    const h = await fixture(api, [bashCall('invalid-admission'), text('Original build completed')],
      { 'output-admission': true }, body => {
        expect(questionIds(body).length).toBeGreaterThan(1)
        return choiceReply(body, 'omit', { omit: 0.99, keep: 0.01, unknown: 0 }, true)
      })
    let spills = 0
    h.ctx.provide('spillStore', { saveText: async () => { spills++; throw new Error('Invalid answers must not request a spill') } } as never)
    await h.ctx.plugin(outputAdmission)
    await mountLogTool(h.ctx)
    await h.run('Build the fixture and summarize the result')
    const result = h.agent.session.snapshotEvents().find(event => event.type === 'tool/result')
    if (result?.type !== 'tool/result') throw new Error('Invalid admission produced no original tool result')
    expect(contentText(result.data.message.content)).toBe(rawLog)
    expect(contentText(h.model.requests[1]!.messages.find(message => message.role === 'tool')!.content)).toBe(rawLog)
    expect(spills).toBe(0)
    expect(h.questions).toEqual([])
    expect(h.received).toHaveLength(1)
    const record = (await h.records('output-admission'))[0]!
    expect(record?.status).toBe('failed')
    expect(record?.attemptRecords[0]?.response).toBeUndefined()
    expect(record?.attemptRecords[0]?.usage).toEqual({ inputTokens: 23, outputTokens: 7 })
    expect(record?.receipts).toEqual([])
    const raw = record?.attemptRecords[0]?.rawResponse
    expect(JSON.stringify(raw)).toContain(api === 'openai' ? 'refusal' : 'unavailable-provider-option')
  })

  it('grants only the eligible native write and preserves sandbox denial for the next call', async () => {
    const h = await fixture(api, [call('one-grant', 'write', { file_path: '../outside/allowed.txt', content: 'approved once',
      sandbox_permissions: 'danger-full-access', justification: 'Write the requested fixture file' }),
    call('no-grant', 'write', { file_path: '../outside/denied.txt', content: 'must remain absent' }), text('Checked both calls')],
    { 'workspace-approval': true }, body => choiceReply(body, 'approve', { approve: 0.97, unauthorized: 0.02, unknown: 0.01 }), 'sandbox')
    await h.ctx.plugin(workspaceApproval)
    await h.run('Write the requested fixture file without publishing')
    expect(h.received).toHaveLength(1)
    expect(h.questions).toEqual([])
    expect(await readFile(join(h.root, 'outside/allowed.txt'), 'utf8')).toBe('approved once')
    await expect(readFile(join(h.root, 'outside/denied.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    const events = h.agent.session.snapshotEvents()
    expect(events.filter(event => event.type === 'approval/decided').map(event => event.data.outcome)).toEqual(['allowed-once'])
    expect(events.filter(event => event.type === 'sandbox/mode')).toEqual([])
    expect(JSON.stringify(events.filter(event => event.type === 'tool/result'))).toContain('FS_SANDBOX_DENIED')
    await vi.waitFor(async () => expect((await h.records('workspace-approval'))[0]?.receipts).toContainEqual(
      expect.objectContaining({ id: 'tool-result', status: 'executed' })))
  })

  it('closes an invalid or refused approval after explicit Cancel without granting or executing it', async () => {
    const h = await fixture(api, [call('refused-write', 'write', { file_path: '../outside/refused.txt', content: 'must remain absent',
      sandbox_permissions: 'danger-full-access', justification: 'Write the requested fixture file' }), text('Approval was cancelled')],
    { 'workspace-approval': true }, body => choiceReply(body, 'approve', { approve: 0.97, unauthorized: 0.02, unknown: 0.01 }, true), 'sandbox')
    await h.ctx.plugin(workspaceApproval)
    await h.run('Write the requested fixture file without publishing')
    expect(h.received).toHaveLength(1)
    expect(h.questions).toHaveLength(1)
    await expect(readFile(join(h.root, 'outside/refused.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(h.agent.session.snapshotEvents().filter(event => event.type === 'approval/decided').map(event => event.data.outcome)).toEqual(['cancelled'])
    const record = (await h.records('workspace-approval'))[0]!
    expect(record?.status).toBe('cancelled')
    expect(record?.attemptRecords[0]?.status).toBe('failed')
    expect(record?.attemptRecords[0]?.response).toBeUndefined()
    expect(record?.receipts.some(receipt => receipt.id === 'grant-issued' || receipt.status === 'executed')).toBe(false)
  })
})

it('lets the original tool finish while official instruction judging is pending, then discards all answers after one refusal', async () => {
  const providerEntered = Promise.withResolvers<void>()
  const providerRelease = Promise.withResolvers<void>()
  const secondModelEntered = Promise.withResolvers<void>()
  const secondModelRelease = Promise.withResolvers<void>()
  let judgments = 0
  const h = await fixture('openai', [call('instruction-write', 'write', { file_path: 'product.txt', content: 'original tool executed' }),
    async () => { secondModelEntered.resolve(); await secondModelRelease.promise; return call('after-refusal', 'probe', {}) }, text('Finished')],
  { 'instruction-guidance': true }, async body => {
    if (judgments++ !== 0) return choiceReply(body, 'no-conflict', { conflict: 0.01, 'no-conflict': 0.97, 'not-applicable': 0.01, undetermined: 0.01 })
    expect(questionIds(body).length).toBeGreaterThan(1)
    providerEntered.resolve()
    await providerRelease.promise
    return choiceReply(body, 'conflict', { conflict: 0.97, 'no-conflict': 0.01, 'not-applicable': 0.01, undetermined: 0.01 }, true)
  })
  cleanups.push(async () => { providerRelease.resolve(); secondModelRelease.resolve() })
  await writeFile(join(h.workspace, 'TEAM.md'), 'Only modify plan.md. Other files require a changed user requirement.\n')
  h.ctx.provide('loader', { entries: () => [{ options: { name: '@deepseek-ai/dsh-agent-instructions' }, fiber: { state: 2, uid: 1, ctx: h.ctx,
    config: { dshHome: join(h.root, 'home'), maxBytes: 24_000, instructionFileCandidates: ['TEAM.md'], localInstructionFileCandidates: [], projectRootMarkers: ['.git'] } } }] } as never)
  const pending: Array<ReturnType<typeof h.ctx.jev.judgeOnce>> = []
  const judgeOnce = h.ctx.jev.judgeOnce.bind(h.ctx.jev)
  vi.spyOn(h.ctx.jev, 'judgeOnce').mockImplementation(options => {
    const result = judgeOnce(options)
    pending.push(result)
    return result
  })
  await h.ctx.plugin(instructions)
  h.ctx.tools.register(defineTool({ name: 'write', description: 'Perform the original local write',
    parameters: { file_path: { type: 'string', required: true }, content: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async args => { await writeFile(join(h.workspace, args.file_path), args.content); return 'original write complete' },
  }))
  h.ctx.tools.register(defineTool({ name: 'probe', description: 'Observe the next original tool path', parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute: async () => 'probe complete' }))
  const run = h.run('Make the requested project change while preserving the applicable instructions')
  await Promise.all([providerEntered.promise, secondModelEntered.promise])
  expect(await readFile(join(h.workspace, 'product.txt'), 'utf8')).toBe('original tool executed')
  expect(h.model.requests).toHaveLength(2)
  expect(h.questions).toEqual([])
  providerRelease.resolve()
  const failed = await pending[0]!
  expect(failed.kind).toBe('failed')
  secondModelRelease.resolve()
  await run
  await Promise.all(pending)
  expect(h.model.requests).toHaveLength(3)
  expect(h.agent.session.deriveMessages().filter(message => message.role === 'user' && message.source.kind === 'jev-instruction-guidance')).toEqual([])
  expect(JSON.stringify(h.model.requests[2]?.messages)).not.toContain('Current instruction conflict')
  expect(h.questions).toEqual([])
  if (failed.operationId === undefined) throw new Error('Instruction refusal has no recorded operation')
  const record = await h.ctx.jev.getRecord(failed.operationId)
  expect(record?.status).toBe('failed')
  expect(record?.receipts).toEqual([])
  expect(record?.attemptRecords[0]?.connection.connectionId).toBe('luna-openai')
  expect(JSON.stringify(record?.attemptRecords[0]?.rawResponse)).toContain('refusal')
})
