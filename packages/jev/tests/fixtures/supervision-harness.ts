import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createVolatile, updateVolatile } from '@deepseek-ai/cosmokit'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { LlmAdapter, createUserMessage, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import GoalService from '@deepseek-ai/dsh-goal'
import * as goalDriver from '@deepseek-ai/dsh-goal-round-driver'
import * as goalTools from '@deepseek-ai/dsh-tool-goal'
import Storage from '@deepseek-ai/dsh-storage'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { JevLedger } from '../../src/ledger.ts'
import JevService from '../../src/index.ts'
import * as todoTool from '@deepseek-ai/dsh-tool-todo'
import * as supervision from '../../src/supervision.ts'

type Entry = StreamChunk[] | ((request: GenerateOptions) => Promise<StreamChunk[]> | StreamChunk[])
class Model extends LlmAdapter {
  requests: GenerateOptions[] = []
  beforeReply?: () => void
  constructor(readonly script: Entry[]) { super() }
  async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(request)
    this.beforeReply?.()
    const entry = this.script.shift()
    if (entry === undefined) throw new Error('Fixture script exhausted')
    for (const chunk of typeof entry === 'function' ? await entry(request) : entry) yield chunk
  }
}
export const text = (value: string): StreamChunk[] => [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'block-end', index: 0, block: { type: 'text', text: value } },
  { type: 'finish', reason: { kind: 'stop' } },
]
export const call = (id: string, name = 'probe', args: object = {}): StreamChunk[] => [
  { type: 'block-start', index: 0, blockType: 'tool-call' },
  { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId(id), name, arguments: args } },
  { type: 'finish', reason: { kind: 'tool-calls' } },
]
export const answer = (value: string) => ({ answers: { assessment: { choice: value }, evidence: { choice: '$first' } } })
type Reply = object | (() => Promise<object>)
export const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

export async function harness(script: Entry[], replies: Reply[], features: Record<string, boolean> = {}, counts: { evidenceChars?: number; driftInterval?: number; maxSupplementRounds?: number; autoTodo?: boolean } = {}, resume?: { root: string; id: ReturnType<typeof SessionId> }) {
  const root = resume?.root ?? await mkdtemp(join(tmpdir(), 'jev-supervision-'))
  if (resume === undefined) cleanups.push(() => rm(root, { recursive: true, force: true }))
  // The fixture captures multiple wire questions and heterogeneous evidence fields for assertions.
  const requests: any[] = []
  const requestListeners = new Set<() => void>()
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    requests.push(JSON.parse(Buffer.concat(chunks).toString()))
    for (const listener of requestListeners) listener()
    const reply = replies.shift() ?? answer('unknown')
    response.writeHead(200, { 'content-type': 'application/json' })
    const result = typeof reply === 'function' ? await reply() : reply
    const question = requests.at(-1).questions.focus ? 'focus' : 'evidence'
    const encoded = JSON.stringify(question === 'focus' && 'answers' in result && typeof result.answers === 'object' && result.answers !== null && 'evidence' in result.answers
      ? { ...result, answers: { ...result.answers, focus: result.answers.evidence, evidence: undefined } } : result).replace('"$first"', JSON.stringify(Object.keys(requests.at(-1).questions[question].criteria)[0]))
    response.end(encoded)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(() => new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close(error => error ? reject(error) : resolve()) }))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('No fixture port')
  const ctx = new Context()
  const errors: unknown[] = []
  ctx.on('agent/error', ({ error }) => { errors.push(error) })
  await ctx.plugin(Storage)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(GoalService)
  await ctx.plugin(goalDriver)
  await ctx.plugin(goalTools)
  const backend = new JsonStorageBackend(join(root, 'storage'))
  const unregister = ctx.storage.backend.register('json', backend)
  const facility = new DomainFacility(ctx, { backend: 'json' })
  ctx.provide('storageDomain', facility)
  ctx.provide('profileContext', { dir: join(root, 'profile') } as never)
  ctx.provide('settings', { configure: () => () => {} } as never)
  ctx.provide('credentials', { resolve: async () => ({ value: 'local-fixture-key', source: 'fixture' }) } as never)
  const common = await ctx.plugin(JevService, {
    baseUrl: `http://127.0.0.1:${address.port}/v1/systemone`, model: 'jev-local', credentialRef: 'JEV_TEST_KEY', timeoutMs: 2_000, features,
  })
  const { autoTodo = features['completion-check'] === true, ...settings } = counts
  const supervising = await ctx.plugin(supervision, { maxSupplementRounds: 1, ...settings })
  await ctx.plugin(todoTool, { allowParallelInProgress: true })
  await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions') })
  await ctx.plugin(AgentLoop, { agents: [] })
  const model = new Model(script)
  ctx.llm.registerAdapter(['fixture'], model)
  ctx.tools.register(defineTool({ name: 'probe', description: 'Record a deterministic investigation', parameters: {},
    output: { schema: { type: 'string' }, render: (_args, result) => [{ type: 'text', text: result }] }, execute: async () => 'No source change; investigation result' }))
  const agent = resume === undefined
    ? await ctx.agentLoop.create(SessionId('supervision-fixture'), { provider: 'fixture', model: 'fixture' })
    : (await ctx.agentLoop.resume(ctx, { resumeSessionId: resume.id, agentOptions: { provider: 'fixture', model: 'fixture' } })).agent
  model.beforeReply = () => {
    const events = agent.session.snapshotEvents()
    const start = events.findLastIndex(event => event.type === 'turn/start')
    if (autoTodo && !events.slice(start).some(event => event.type === 'todo/write')) agent.session.append('todo/write', { todos: [{ content: 'Task report: no verification result yet', status: 'pending' }] })
  }
  let disposed = false
  const dispose = async () => { if (disposed) return; disposed = true; await ctx.fiber.dispose(); unregister(); await facility.closeAll(); await backend.close() }
  cleanups.push(dispose)
  const send = (value: string) => agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: value }] }))
  const records = () => ctx.jev.listRecords({ sessionId: agent.id, limit: 100 })
  const requestSeen = (count: number) => requests.length >= count ? Promise.resolve() : new Promise<void>(resolve => {
    const listener = () => { if (requests.length >= count) { requestListeners.delete(listener); resolve() } }; requestListeners.add(listener)
  })
  return { requestSeen, ctx, agent, model, requests, send, records, errors, dispose, features: common.config.features, counts: supervising.config, root }
}
export const visible = (agent: Agent) => agent.session.deriveMessages().flatMap(message => message.content).filter(block => block.type === 'text').map(block => block.text).join('\n')
