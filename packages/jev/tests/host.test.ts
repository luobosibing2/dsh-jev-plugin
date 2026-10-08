import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createVolatile, updateVolatile, type Volatile } from '@deepseek-ai/cosmokit'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import Storage from '@deepseek-ai/dsh-storage'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import JevService, { Config, JevError } from '../src/index.ts'
import { JevLedger, ledgerSpec } from '../src/ledger.ts'
import type { JevConfigValues, JevRequest } from '../src/types.ts'
import { routerRequest } from './fixtures/decisions-request.ts'

const request: JevRequest = {
  state: {},
  questions: [
    { id: 'route', kind: 'choice', prompt: 'Choose route', options: [
      { id: 'left', description: 'left path' }, { id: 'right', description: 'right path' },
    ] },
    { id: 'risk', kind: 'score', prompt: 'Rate risk', levels: ['low', 'medium', 'high'] },
    { id: 'ready', kind: 'noul', prompt: 'Ready?' },
  ],
}

const valid = {
  answers: {
    route: { choice: 'left', probabilities: { left: 0.7, right: 0.3 } },
    risk: { score: 1.5, probabilities: { '0': 0.1, '1': 0.4, '2': 0.5 } },
    ready: { noul: 0.8 },
  },
  usage: { input_tokens: 17, output_tokens: 5 },
}

type Reply = object | string | ((body: Record<string, unknown>) => Promise<object>)

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  const failures: unknown[] = []
  for (const cleanup of cleanups.splice(0).reverse()) {
    try { await cleanup() } catch (error) { failures.push(error) }
  }
  if (failures.length) throw new AggregateError(failures, 'Jev fixture cleanup failed')
})

async function fixture(replies: Reply[], validate?: (body: Record<string, unknown>) => void, status = 200) {
  const received: object[] = []
  const authorizations: (string | undefined)[] = []
  const validationErrors: unknown[] = []
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const requestBody = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
    received.push(requestBody)
    authorizations.push(request.headers.authorization)
    try { validate?.(requestBody) }
    catch (error) {
      validationErrors.push(error)
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end('{}')
      return
    }
    const reply = replies.shift()
    const body = typeof reply === 'function' ? await reply(requestBody) : reply
    response.writeHead(status, { 'content-type': 'application/json' })
    response.end(typeof body === 'string' ? body : JSON.stringify(body ?? valid))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('HTTP fixture did not bind an ephemeral port')
  cleanups.push(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) })
  return { url: `http://127.0.0.1:${address.port}/v1/systemone`, received, authorizations, validationErrors }
}

async function setup(options: { root: string; profile: string; url: string; enabled?: boolean; timeoutMs?: number; config?: Partial<JevConfigValues>;
  credentials?: { resolve?: (ref: string) => Promise<{ value: string; source: string } | undefined>; describe?: () => Promise<{ configured: boolean; writable: boolean; source?: string }>; set?: (ref: string, value: string) => Promise<void> } }) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  const backend = new JsonStorageBackend(options.root)
  const unregister = ctx.storage.backend.register('json', backend)
  const facility = new DomainFacility(ctx, { backend: 'json' })
  ctx.provide('storageDomain', facility)
  ctx.provide('profileContext', { dir: options.profile } as never)
  ctx.provide('settings', { configure: () => () => {} } as never)
  ctx.provide('credentials', {
    resolve: async () => ({ value: 'local-fixture-key', source: 'fixture' }),
    describe: async () => ({ configured: true, writable: true, source: 'fixture' }),
    set: async () => {},
    ...options.credentials,
  } as never)
  const jevFiber = await ctx.plugin(JevService, {
    baseUrl: options.url, model: 'jev-local', credentialRef: 'JEV_TEST_KEY', timeoutMs: options.timeoutMs ?? 10_000,
    features: { fixture: options.enabled ?? true },
    ...options.config,
  })
  const agent = { id: 'fixture-session', session: { id: 'fixture-session', header: { delegationDepth: 0 } } } as Agent
  ctx.agents.enter(agent, undefined)
  let disposed = false
  const dispose = async () => {
    if (disposed) return
    disposed = true
    await ctx.fiber.dispose()
    unregister()
    await facility.closeAll()
    await backend.close()
  }
  cleanups.push(dispose)
  return { ctx, agent, dispose, jevFiber, config: jevFiber.config as Config, features: jevFiber.config.features as Volatile<Record<string, boolean>> }
}

async function root() {
  const path = await mkdtemp(join(tmpdir(), 'jev-host-test-'))
  cleanups.push(() => rm(path, { recursive: true, force: true }))
  return path
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function manyQuestions(count: number): JevRequest {
  return { state: { full: ['shared', null, { count }] }, questions: Array.from({ length: count }, (_, index) => ({ id: `q-${index}`, kind: 'noul' as const, prompt: `Question ${index}` })) }
}

function systemAnswers(body: Record<string, unknown>, usage: object = { input_tokens: 7, output_tokens: 2 }) {
  return { model: 'returned-luna-router', answers: Object.fromEntries(Object.keys(body.questions as object).map(id => [id, { type: 'noul', noul: 0.8 }])), usage }
}

const nativeValid = { model: 'returned-luna-official', extra: { unknown: ['retained'] }, answers: [
  { type: 'predicate', name: 'ready', probability: 0.8 },
  { type: 'choice', name: 'route', choice: 'left', confidence: 0.7, probabilities: [{ value: 'left', probability: 0.7 }, { value: 'right', probability: 0.3 }] },
  { type: 'score', name: 'risk', score: 1.5, confidence: 0.9, probabilities: [{ value: 0, label: '0', probability: 0.1 }, { value: 1, label: '1', probability: 0.4 }, { value: 2, label: '2', probability: 0.5 }] },
], usage: { input_tokens: 12 } }

const channels = [
  { connectionId: 'jev', config: {}, valid },
  { connectionId: 'luna-openrouter', config: { judgmentModel: 'luna', lunaApi: 'openrouter' }, valid },
  { connectionId: 'luna-openai', config: { judgmentModel: 'luna', lunaApi: 'openai' }, valid: nativeValid },
] as const

// Literal overflow must reach JSON.parse unchanged: JSON.stringify(Infinity) would send null.
function overflowMetadata(body: object): string {
  return `${JSON.stringify(body).slice(0, -1)},"metadata":{"nested":[{"overflow":1e400}]}}`
}

describe.each(channels)('non-finite provider JSON on $connectionId', channel => {
  async function connect(http: Awaited<ReturnType<typeof fixture>>) {
    const path = await root()
    const options = { root: join(path, 'storage'), profile: join(path, 'profile'), url: http.url,
      config: { ...channel.config, lunaOpenRouterBaseUrl: http.url, lunaOpenAIBaseUrl: http.url } }
    return { ...await setup(options), options }
  }

  it.each([
    { name: 'top-level overflow', raw: '1e400' },
    { name: 'nested negative overflow', raw: '{"answers":{"ready":{"noul":-1e400}}}' },
    { name: 'overflow in metadata alongside valid answers', raw: overflowMetadata(channel.valid) },
  ])('settles a background $name as INVALID_RESPONSE and retains the exact text', async ({ raw }) => {
    const http = await fixture([raw])
    const { ctx } = await connect(http)
    ctx.jev.registerFeature({ id: 'fixture', name: 'Fixture', description: 'Test only' })
    const result = await ctx.jev.judgeOnce({ featureId: 'fixture', link: {}, refresh: () => request })
    expect(result).toMatchObject({ kind: 'failed', failure: { code: 'INVALID_RESPONSE' } })
    const detail = (await ctx.jev.getRecord(result.operationId!))!
    expect(detail).toMatchObject({ status: 'failed', attempts: 1 })
    const attempt = detail.attemptRecords[0]!
    expect(attempt).toMatchObject({ status: 'failed', settledAt: expect.any(String), failure: { code: 'INVALID_RESPONSE' } })
    expect(attempt.response).toBeUndefined()
    expect(attempt.rawResponse).toBeUndefined()
    expect(attempt.networkRecords).toHaveLength(1)
    expect(attempt.networkRecords![0]).toMatchObject({ status: 'failed', httpStatus: 200, settledAt: expect.any(String),
      rawResponseText: raw, failure: { code: 'INVALID_RESPONSE' } })
    expect(attempt.networkRecords![0]!.rawResponse).toBeUndefined()
    expect(http.received).toHaveLength(1)
  })

  it.each([
    { status: 400, code: 'BAD_REQUEST' }, { status: 401, code: 'AUTH' }, { status: 403, code: 'AUTH' },
    { status: 402, code: 'PAYMENT_REQUIRED' }, { status: 429, code: 'RATE_LIMIT' }, { status: 503, code: 'SERVER' },
  ])('preserves HTTP $status classification despite nested overflow', async ({ status, code }) => {
    const raw = overflowMetadata(channel.valid)
    const http = await fixture([raw], undefined, status)
    const { ctx } = await connect(http)
    ctx.jev.registerFeature({ id: 'fixture', name: 'Fixture', description: 'Test only' })
    const result = await ctx.jev.judgeOnce({ featureId: 'fixture', link: {}, refresh: () => request })
    expect(result).toMatchObject({ kind: 'failed', failure: { code } })
    const detail = (await ctx.jev.getRecord(result.operationId!))!
    expect(detail).toMatchObject({ status: 'failed' })
    expect(detail.attemptRecords[0]).toMatchObject({ status: 'failed', settledAt: expect.any(String), failure: { code } })
    expect(detail.attemptRecords[0]!.networkRecords![0]).toMatchObject({ status: 'failed', httpStatus: status,
      rawResponseText: raw, settledAt: expect.any(String), failure: { code } })
    expect(detail.attemptRecords[0]!.networkRecords![0]!.rawResponse).toBeUndefined()
  })

  it('settles a diagnostic through schema-checked network writes and retains it after reopening storage', async () => {
    const raw = overflowMetadata(channel.valid)
    const http = await fixture([raw])
    const { ctx, dispose, options } = await connect(http)
    const schema = ledgerSpec(options.profile).tables.operations.valueSchema
    const original = JevLedger.prototype.saveNetwork
    // Enforce the actual ledger schema at the write boundary as well as on reload.
    const writing = vi.spyOn(JevLedger.prototype, 'saveNetwork').mockImplementation(async function (operationId, attemptId, records) {
      const current = this.get(operationId)!
      schema.parse({ ...current, attemptRecords: current.attemptRecords.map(attempt =>
        attempt.id === attemptId ? { ...attempt, networkRecords: records } : attempt) })
      await original.call(this, operationId, attemptId, records)
    })
    const result = await ctx.jev.testConnection(ctx.jev.judgmentConnectionIdentity(), new AbortController().signal)
      .finally(() => writing.mockRestore())
    expect(result).toMatchObject({ ok: false, failure: { code: 'INVALID_RESPONSE' } })
    const detail = (await ctx.jev.getRecord(result.recordId))!
    expect(detail).toMatchObject({ diagnostic: true, status: 'failed', attempts: 1 })
    expect(detail.attemptRecords[0]).toMatchObject({ status: 'failed', settledAt: expect.any(String), failure: { code: 'INVALID_RESPONSE' } })
    expect(detail.attemptRecords[0]!.networkRecords![0]).toMatchObject({ rawResponseText: raw, settledAt: expect.any(String) })
    expect(detail.attemptRecords[0]!.networkRecords![0]!.rawResponse).toBeUndefined()
    expect(schema.safeParse(detail).success).toBe(true)
    await dispose()
    const reopened = await setup(options)
    expect(await reopened.ctx.jev.getRecord(result.recordId)).toEqual(detail)
  })

  it.each(['retry', 'cancel'] as const)('persists the failed interactive attempt before manual %s', async choice => {
    const raw = overflowMetadata(channel.valid)
    const http = await fixture([raw, channel.valid])
    const { ctx, agent } = await connect(http)
    ctx.jev.registerFeature({ id: 'fixture', name: 'Fixture', description: 'Test only' })
    const asked = deferred<void>()
    const answer = deferred<{ answers: { id: string; selected: string[] }[] }>()
    ctx.on('user-questions/request', () => { asked.resolve(); return answer.promise })
    const pending = ctx.jev.judge({ featureId: 'fixture', link: {}, agent, refresh: () => request })
    // Race against completion so a rejected judgment cannot hide behind an unasked question.
    await Promise.race([asked.promise, pending.then(() => { throw new Error('Judgment completed before manual resolution') })])
    const page = await ctx.jev.listRecords({})
    const detail = (await ctx.jev.getRecord(page.items[0]!.id))!
    expect(detail).toMatchObject({ status: 'waiting', attempts: 1 })
    expect(detail.attemptRecords[0]).toMatchObject({ status: 'failed', settledAt: expect.any(String), failure: { code: 'INVALID_RESPONSE' } })
    expect(detail.attemptRecords[0]!.networkRecords![0]).toMatchObject({ rawResponseText: raw, settledAt: expect.any(String) })
    expect(detail.attemptRecords[0]!.networkRecords![0]!.rawResponse).toBeUndefined()
    expect(http.received).toHaveLength(1)
    answer.resolve({ answers: [{ id: 'jev-resolution', selected: [choice === 'retry' ? '重试 / Retry' : '取消 / Cancel'] }] })
    const result = await pending
    expect(result.kind).toBe(choice === 'retry' ? 'ok' : 'cancelled')
    expect(await ctx.jev.getRecord(detail.id)).toMatchObject({ status: choice === 'retry' ? 'succeeded' : 'cancelled',
      attempts: choice === 'retry' ? 2 : 1 })
    expect(http.received).toHaveLength(choice === 'retry' ? 2 : 1)
  })
})

describe('saved Luna channels, complete attempts and original-response history', () => {
  it.each([200, 201, 401])('covers all %i OpenRouter questions once and persists each actual exchange', async count => {
    const path = await root()
    const batches = Math.ceil(count / 200)
    const http = await fixture(Array.from({ length: batches }, () => async body => systemAnswers(body)), body => { routerRequest.parse(body) })
    const { ctx } = await setup({ root: join(path, 'storage'), profile: join(path, 'profile'), url: '', config: {
      judgmentModel: 'luna', lunaApi: 'openrouter', lunaOpenRouterBaseUrl: http.url,
    } })
    ctx.jev.registerFeature({ id: 'fixture', name: 'Fixture', description: 'Test only' })
    const input = manyQuestions(count)
    const result = await ctx.jev.judgeOnce({ featureId: 'fixture', link: {}, refresh: () => input })
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') throw new Error('Expected complete local result')
    expect(result.response.answers.map(answer => answer.id)).toEqual(input.questions.map(question => question.id))
    expect(http.received).toHaveLength(batches)
    expect(http.received).toEqual(Array.from({ length: batches }, (_, index) => ({ model: 'openai/gpt-6-luna-decisions', state: input.state,
      questions: Object.fromEntries(input.questions.slice(index * 200, (index + 1) * 200).map(question => [question.id, { type: 'noul', instructions: question.prompt }])) })))
    const attempt = (await ctx.jev.getRecord(result.operationId))!.attemptRecords[0]!
    expect(attempt.connection.connectionId).toBe('luna-openrouter')
    expect(attempt.networkRecords).toHaveLength(batches)
    expect(attempt.networkRecords!.map(record => record.questionIds).flat()).toEqual(input.questions.map(question => question.id))
    expect(attempt.usage).toEqual({ inputTokens: batches * 7, outputTokens: batches * 2 })
    expect(attempt.usageComplete).toBe(true)
    expect(attempt.networkRecords!.every(record => record.returnedModel === 'returned-luna-router')).toBe(true)
    expect(attempt.networkRecords!.every(record => record.rawResponseText === JSON.stringify(record.rawResponse))).toBe(true)
    expect(http.validationErrors).toEqual([])
  })

  it('sends scalar state and missing descriptions through a strict OpenRouter HTTP fixture and replays them from the original business input', async () => {
    const path = await root()
    const http = await fixture([valid], body => { routerRequest.parse(body) })
    const { ctx } = await setup({ root: join(path, 'storage'), profile: join(path, 'profile'), url: '', config: { judgmentModel: 'luna', lunaOpenRouterBaseUrl: http.url } })
    ctx.jev.registerFeature({ id: 'fixture', name: 'Fixture', description: 'Test only' })
    const input: JevRequest = { state: false, questions: [request.questions[0]!,
      { id: 'risk', kind: 'score', prompt: ['exact rubric instruction'], levels: [null, 'middle', null] },
      { id: 'ready', kind: 'noul', prompt: { original: 'ready condition' }, criteria: { true: null, false: ['not ready'] } },
    ] }
    const result = await ctx.jev.judgeOnce({ featureId: 'fixture', link: {}, refresh: () => input })
    expect(result.kind).toBe('ok')
    expect(http.validationErrors).toEqual([])
    expect(http.received[0]).toMatchObject({ state: 'false', questions: {
      risk: { criteria: ['', 'middle', ''] }, ready: { instructions: { instructions: { original: 'ready condition' }, criteria: { true: null, false: ['not ready'] } } },
    } })
    expect((await ctx.jev.getRecord(result.operationId!))?.attemptRecords[0]?.request).toEqual(input)
  })

  it('retains known partial usage and no adoptable answers after a second batch fails', async () => {
    const path = await root()
    const http = await fixture([async body => systemAnswers(body, { input_tokens: 13 }), { answers: {}, usage: { output_tokens: 4 } }])
    const { ctx } = await setup({ root: join(path, 'storage'), profile: join(path, 'profile'), url: '', config: { judgmentModel: 'luna', lunaOpenRouterBaseUrl: http.url } })
    ctx.jev.registerFeature({ id: 'fixture', name: 'Fixture', description: 'Test only' })
    const result = await ctx.jev.judgeOnce({ featureId: 'fixture', link: {}, refresh: () => manyQuestions(401) })
    expect(result).toMatchObject({ kind: 'failed', failure: { code: 'INVALID_RESPONSE' } })
    expect(http.received).toHaveLength(2)
    const attempt = (await ctx.jev.getRecord(result.operationId!))!.attemptRecords[0]!
    expect(attempt.response).toBeUndefined()
    expect(attempt.usage).toEqual({ inputTokens: 13, outputTokens: 4 })
    expect(attempt.usageComplete).toBe(false)
    expect(attempt.networkRecords?.map(record => record.status)).toEqual(['succeeded', 'failed'])
  })

  it('shares one deadline across batches and stops before a third request', async () => {
    const path = await root()
    const held = deferred<object>()
    const entered = deferred<void>()
    const http = await fixture([async body => systemAnswers(body), async () => { entered.resolve(); return held.promise }])
    cleanups.push(async () => { held.resolve({ answers: {} }) })
    const { ctx } = await setup({ root: join(path, 'storage'), profile: join(path, 'profile'), url: '', timeoutMs: 150, config: { judgmentModel: 'luna', lunaOpenRouterBaseUrl: http.url } })
    ctx.jev.registerFeature({ id: 'fixture', name: 'Fixture', description: 'Test only' })
    const deadline = new AbortController()
    const clock = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
    try {
      const resultPromise = ctx.jev.judgeOnce({ featureId: 'fixture', link: {}, refresh: () => manyQuestions(401) })
      await entered.promise
      expect(clock).toHaveBeenCalledExactlyOnceWith(150)
      deadline.abort()
      const result = await resultPromise
      expect(result).toMatchObject({ kind: 'failed', failure: { code: 'TIMEOUT' } })
      expect(http.received).toHaveLength(2)
      const attempt = (await ctx.jev.getRecord(result.operationId!))!.attemptRecords[0]!
      expect(attempt.response).toBeUndefined()
      expect(attempt.usage).toEqual({ inputTokens: 7, outputTokens: 2 })
      expect(attempt.usageComplete).toBe(false)
    } finally { clock.mockRestore(); held.resolve({ answers: {} }) }
  })

  it('freezes the channel and authentication for all batches, then uses the newly saved connection', async () => {
    const path = await root()
    const entered = deferred<void>()
    const held = deferred<void>()
    const router = await fixture([async body => { entered.resolve(); await held.promise; return systemAnswers(body) }, async body => systemAnswers(body)])
    const official = await fixture([nativeValid])
    let key = 'first-fixture-key'
    const { ctx, config } = await setup({ root: join(path, 'storage'), profile: join(path, 'profile'), url: '', config: {
      judgmentModel: 'luna', lunaOpenRouterBaseUrl: router.url, lunaOpenAIBaseUrl: official.url,
    }, credentials: { resolve: async () => ({ value: key, source: 'fixture' }) } })
    ctx.jev.registerFeature({ id: 'fixture', name: 'Fixture', description: 'Test only' })
    const pending = ctx.jev.judgeOnce({ featureId: 'fixture', link: {}, refresh: () => manyQuestions(201) })
    await entered.promise
    updateVolatile(config.lunaApi, createVolatile('openai'))
    key = 'new-fixture-key'
    held.resolve()
    const first = await pending
    expect(first.kind).toBe('ok')
    expect(router.authorizations).toEqual(['Bearer first-fixture-key', 'Bearer first-fixture-key'])
    expect(official.received).toHaveLength(0)
    expect((await ctx.jev.getRecord(first.operationId!))?.attemptRecords[0]?.connection).toMatchObject({ connectionId: 'luna-openrouter' })
    const next = await ctx.jev.judgeOnce({ featureId: 'fixture', link: {}, refresh: () => request })
    expect(next.kind).toBe('ok')
    expect(official.authorizations).toEqual(['Bearer new-fixture-key'])
    expect(official.received[0]).toMatchObject({ model: 'gpt-6-luna', input: '{}', questions: [{ type: 'choice' }, { type: 'score' }, { type: 'predicate' }] })
  })

  it('reopens native raw arrays and rejects a modified raw probability with an unchanged saved answer', async () => {
    const path = await root()
    const http = await fixture([nativeValid])
    const options = { root: join(path, 'storage'), profile: join(path, 'profile'), url: '', config: { judgmentModel: 'luna' as const, lunaApi: 'openai' as const, lunaOpenAIBaseUrl: http.url } }
    const first = await setup(options)
    first.ctx.jev.registerFeature({ id: 'fixture', name: 'Fixture', description: 'Test only' })
    const result = await first.ctx.jev.judgeOnce({ featureId: 'fixture', link: {}, refresh: () => request })
    expect(result.kind).toBe('ok')
    const detail = (await first.ctx.jev.getRecord(result.operationId!))!
    expect(detail.attemptRecords[0]?.rawResponse).toEqual(nativeValid)
    expect(detail.attemptRecords[0]?.usage).toEqual({ inputTokens: 12 })
    expect(detail.attemptRecords[0]?.usageComplete).toBe(false)
    await first.dispose()
    const second = await setup(options)
    expect((await second.ctx.jev.getRecord(detail.id))?.attemptRecords[0]?.response).toEqual(detail.attemptRecords[0]?.response)
    const schema = ledgerSpec(options.profile).tables.operations.valueSchema
    expect(schema.safeParse(detail).success).toBe(true)
    const changed = structuredClone(detail)
    const raw = changed.attemptRecords[0]!.networkRecords![0]!.rawResponse as typeof nativeValid
    raw.answers[0]!.probability = 0.1
    changed.attemptRecords[0]!.networkRecords![0]!.rawResponseText = JSON.stringify(raw)
    changed.attemptRecords[0]!.rawResponse = raw
    expect(schema.safeParse(changed).success).toBe(false)
  })

  it.each([
    { usage: { input_tokens: 12 }, expectedUsage: { inputTokens: 12 }, complete: false },
    { usage: { input_tokens: 7, output_tokens: 3 }, expectedUsage: { inputTokens: 7, outputTokens: 3 }, complete: true },
  ])('retains a refusal and its reported usage completeness $complete without adopting other answers', async ({ usage, expectedUsage, complete }) => {
    const path = await root()
    const refused = { ...nativeValid, usage, answers: [{ type: 'refusal', name: 'ready' }, ...nativeValid.answers.slice(1)] }
    const http = await fixture([refused])
    const { ctx } = await setup({ root: join(path, 'storage'), profile: join(path, 'profile'), url: http.url, config: { judgmentModel: 'luna', lunaApi: 'openai', lunaOpenAIBaseUrl: http.url } })
    ctx.jev.registerFeature({ id: 'fixture', name: 'Fixture', description: 'Test only' })
    const result = await ctx.jev.judgeOnce({ featureId: 'fixture', link: {}, refresh: () => request })
    expect(result).toMatchObject({ kind: 'failed', failure: { code: 'REFUSAL' } })
    expect(http.received).toHaveLength(1)
    expect((await ctx.jev.getRecord(result.operationId!))?.attemptRecords[0]).toMatchObject({ rawResponse: refused, usage: expectedUsage, usageComplete: complete })
    expect((await ctx.jev.getRecord(result.operationId!))?.attemptRecords[0]?.response).toBeUndefined()
  })

  it('marks usage incomplete when two fully reported OpenRouter packets fail before the third expected packet', async () => {
    const path = await root()
    const http = await fixture([async body => systemAnswers(body), { answers: {}, usage: { input_tokens: 7, output_tokens: 3 } }])
    const { ctx } = await setup({ root: join(path, 'storage'), profile: join(path, 'profile'), url: '', config: { judgmentModel: 'luna', lunaOpenRouterBaseUrl: http.url } })
    ctx.jev.registerFeature({ id: 'fixture', name: 'Fixture', description: 'Test only' })
    const result = await ctx.jev.judgeOnce({ featureId: 'fixture', link: {}, refresh: () => manyQuestions(401) })
    expect(result).toMatchObject({ kind: 'failed', failure: { code: 'INVALID_RESPONSE' } })
    expect(http.received).toHaveLength(2)
    const attempt = (await ctx.jev.getRecord(result.operationId!))!.attemptRecords[0]!
    expect(attempt.response).toBeUndefined()
    expect(attempt.usage).toEqual({ inputTokens: 14, outputTokens: 5 })
    expect(attempt.usageComplete).toBe(false)
  })

  it('rejects stale credential actions and keeps awaited status and writes associated with the original reference', async () => {
    const path = await root()
    const http = await fixture([])
    const gate = deferred<void>()
    const entered = deferred<void>()
    const writes: { ref: string; value: string }[] = []
    const { ctx, config } = await setup({ root: join(path, 'storage'), profile: join(path, 'profile'), url: http.url, credentials: {
      set: async (ref, value) => { writes.push({ ref, value }); entered.resolve(); await gate.promise },
    } })
    const original = ctx.jev.judgmentConnectionIdentity()
    expect((await ctx.jev.getCredentialStatus(original)).connection).toEqual(original)
    const pending = ctx.jev.setCredential(original, 'dummy-new-key')
    await entered.promise
    updateVolatile(config.credentialRef, createVolatile('NEW_JEV_REF'))
    gate.resolve()
    expect((await pending).connection).toEqual(original)
    expect(writes).toEqual([{ ref: 'JEV_TEST_KEY', value: 'dummy-new-key' }])
    await expect(ctx.jev.setCredential(original, 'stale-key')).rejects.toMatchObject({ code: 'CONNECTION_CHANGED' })
    await expect(ctx.jev.getCredentialStatus(original)).rejects.toMatchObject({ code: 'CONNECTION_CHANGED' })
    await expect(ctx.jev.testConnection(original, new AbortController().signal)).rejects.toMatchObject({ code: 'CONNECTION_CHANGED' })
    expect(writes).toHaveLength(1)
    expect(http.received).toHaveLength(0)
  })

  it('returns a late probe with its captured connection and rejects any incomplete three-kind response', async () => {
    const path = await root()
    const entered = deferred<void>()
    const held = deferred<object>()
    const http = await fixture([async () => { entered.resolve(); return held.promise }, { answers: { ready: { noul: 1 } } }])
    const { ctx, config } = await setup({ root: join(path, 'storage'), profile: join(path, 'profile'), url: http.url, config: { lunaOpenRouterBaseUrl: http.url } })
    const original = ctx.jev.judgmentConnectionIdentity()
    const pending = ctx.jev.testConnection(original, new AbortController().signal)
    await entered.promise
    updateVolatile(config.judgmentModel, createVolatile('luna'))
    held.resolve(valid)
    expect(await pending).toMatchObject({ ok: true, connection: original })
    const failed = await ctx.jev.testConnection(ctx.jev.judgmentConnectionIdentity(), new AbortController().signal)
    expect(failed).toMatchObject({ ok: false, connection: { connectionId: 'luna-openrouter' }, failure: { code: 'INVALID_RESPONSE' } })
    expect(http.received).toHaveLength(2)
  })

  it('settles a prepared request without dispatch when cancellation arrives during its durable input write', async () => {
    const path = await root()
    const http = await fixture([valid])
    const { ctx } = await setup({ root: join(path, 'storage'), profile: join(path, 'profile'), url: http.url })
    ctx.jev.registerFeature({ id: 'fixture', name: 'Fixture', description: 'Test only' })
    const entered = deferred<void>()
    const gate = deferred<void>()
    const controller = new AbortController()
    const original = JevLedger.prototype.saveNetwork
    let calls = 0
    const writing = vi.spyOn(JevLedger.prototype, 'saveNetwork').mockImplementation(async function (operationId, attemptId, records) {
      await original.call(this, operationId, attemptId, records)
      if (++calls === 1) { entered.resolve(); await gate.promise }
    })
    try {
      const pending = ctx.jev.judgeOnce({ featureId: 'fixture', link: {}, refresh: () => request, signal: controller.signal })
      await entered.promise
      controller.abort()
      gate.resolve()
      const result = await pending
      expect(result.kind).toBe('cancelled')
      expect(http.received).toHaveLength(0)
      const exchange = (await ctx.jev.getRecord(result.operationId!))?.attemptRecords[0]?.networkRecords?.[0]
      expect(exchange).toMatchObject({ status: 'failed', failure: { code: 'ABORTED' } })
      expect(exchange?.settledAt).toEqual(expect.any(String))
      expect(exchange?.dispatchedAt).toBeUndefined()
      expect(exchange?.httpStatus).toBeUndefined()
    } finally { gate.resolve(); writing.mockRestore() }
  })
})

describe('Jev Host through Cordis, LlmRuntime, JSON storage, and local HTTP', () => {
  it('rejects secret-bearing or malformed connection settings at configuration validation', () => {
    expect(() => Config({ baseUrl: 'https://user:key@example.test/v1/systemone' })).toThrow()
    expect(() => Config({ baseUrl: 'https://example.test/v1/systemone?api_key=secret' })).toThrow()
    expect(() => Config({ baseUrl: 'https://example.test/v1/systemone#token' })).toThrow()
    expect(() => Config({ credentialRef: 'BAD-REF' })).toThrow()
    expect(() => Config({ model: ' ' })).toThrow()
    expect(Config({ baseUrl: '' }).baseUrl.get()).toBe('')
  })
  it('publishes a synchronous committed feature snapshot only when enablement changes', async () => {
    const path = await root()
    const http = await fixture([])
    const { ctx, jevFiber, features } = await setup({ root: join(path, 'storage'), profile: join(path, 'profile'), url: http.url })
    const observed: boolean[] = []
    const dispose = ctx.jev.onFeatureStateChange(snapshot => {
      observed.push(snapshot.fixture === true)
      expect(ctx.jev.isFeatureEnabled('fixture')).toBe(snapshot.fixture === true)
      expect(Object.isFrozen(snapshot)).toBe(true)
    })
    const own: Context = Object.create(jevFiber.ctx)
    own[Context.filter] = owner => owner.fiber === jevFiber
    updateVolatile(features, createVolatile({ fixture: false }))
    jevFiber.ctx.emit(own, 'loader/volatile-update', [['features']])
    expect(observed).toEqual([false])
    jevFiber.ctx.emit(own, 'loader/volatile-update', [['timeoutMs']])
    expect(observed).toEqual([false])
    dispose()
    updateVolatile(features, createVolatile({ fixture: true }))
    jevFiber.ctx.emit(own, 'loader/volatile-update', [['features']])
    expect(observed).toEqual([false])
  })

  it('records interrupted disabled-feature input idempotently with zero attempts, HTTP requests, and questions', async () => {
    const path = await root()
    const http = await fixture([])
    const { ctx } = await setup({ root: join(path, 'storage'), profile: join(path, 'profile'), url: http.url, enabled: false })
    ctx.jev.registerFeature({ id: 'fixture', name: 'Fixture', description: 'Test only' })
    const ask = vi.fn()
    ctx.on('user-questions/request', ask)
    const first = await ctx.jev.recordInterrupted('fixture', { sessionId: 'session', inputVersion: 'original-message-id' })
    const second = await ctx.jev.recordInterrupted('fixture', { sessionId: 'session', inputVersion: 'original-message-id' })
    expect(first).toMatchObject({ status: 'interrupted', attempts: 0, attemptRecords: [], failure: { code: 'INTERRUPTED' } })
    expect(second).toEqual(first)
    expect((await ctx.jev.listRecords({})).items).toHaveLength(1)
    expect(http.received).toHaveLength(0)
    expect(ask).not.toHaveBeenCalled()
    await expect(ctx.jev.recordInterrupted('unknown', { sessionId: 'session', inputVersion: 'message' })).rejects.toMatchObject({ code: 'UNKNOWN_FEATURE' })
  })

  it('blocks a disabled feature without sending a request', async () => {
    const path = await root()
    const http = await fixture([])
    const { ctx, agent } = await setup({ root: join(path, 'storage'), profile: join(path, 'profile'), url: http.url, enabled: false })
    ctx.jev.registerFeature({ id: 'fixture', name: 'Fixture', description: 'Test only' })
    await expect(ctx.jev.judge({ featureId: 'fixture', link: { sessionId: 'fixture-session' }, agent, refresh: () => request }))
      .rejects.toMatchObject({ code: 'FEATURE_DISABLED' })
    expect(http.received).toHaveLength(0)
  })

  it('records a complete typed request and successful response before returning it', async () => {
    const path = await root()
    const http = await fixture([valid])
    const { ctx, agent } = await setup({ root: join(path, 'storage'), profile: join(path, 'profile'), url: http.url })
    ctx.jev.registerFeature({ id: 'fixture', name: 'Fixture', description: 'Test only' })
    const outcome = await ctx.jev.judge({ featureId: 'fixture', link: { sessionId: 'fixture-session', inputVersion: 'v1' }, agent, refresh: () => request })
    expect(outcome.kind).toBe('ok')
    if (outcome.kind !== 'ok') return
    expect(outcome.response.answers[1]).toMatchObject({ kind: 'score', value: 1.5 })
    expect(http.received[0]).toMatchObject({ model: 'jev-local', state: {}, questions: { risk: { type: 'score', criteria: ['low', 'medium', 'high'] } } })
    const record = await ctx.jev.getRecord(outcome.operationId)
    expect(record?.attemptRecords[0]).toMatchObject({ status: 'succeeded', usage: { inputTokens: 17, outputTokens: 5 } })
    expect(JSON.stringify(record)).not.toContain('local-fixture-key')
  })

  it('makes a single non-interactive attempt and retains failure evidence', async () => {
    const path = await root()
    const http = await fixture([{ answers: {} }])
    const { ctx, agent } = await setup({ root: join(path, 'storage'), profile: join(path, 'profile'), url: http.url })
    ctx.jev.registerFeature({ id: 'fixture', name: 'Fixture', description: 'Test only' })
    const ask = vi.fn()
    ctx.on('user-questions/request', ask)
    const result = await ctx.jev.judgeOnce({ featureId: 'fixture', agent, link: {}, refresh: () => request })
    expect(result).toMatchObject({ kind: 'failed', failure: { code: 'INVALID_RESPONSE' } })
    expect(ask).not.toHaveBeenCalled()
    expect(http.received).toHaveLength(1)
    expect((await ctx.jev.getRecord(result.operationId!))?.attemptRecords).toHaveLength(1)
  })

  it('records a sanitized refresh failure without an HTTP attempt or human question', async () => {
    const path = await root()
    const http = await fixture([])
    const { ctx, agent } = await setup({ root: join(path, 'storage'), profile: join(path, 'profile'), url: http.url })
    ctx.jev.registerFeature({ id: 'fixture', name: 'Fixture', description: 'Test only' })
    const ask = vi.fn()
    ctx.on('user-questions/request', ask)
    const result = await ctx.jev.judgeOnce({ featureId: 'fixture', agent, link: {}, refresh: () => { throw new JevError('RULE_READ_FAILED', 'private text that must not be stored') } })
    expect(result).toMatchObject({ kind: 'failed', failure: { code: 'RULE_READ_FAILED' } })
    expect(http.received).toHaveLength(0)
    expect(ask).not.toHaveBeenCalled()
    const record = await ctx.jev.getRecord(result.operationId!)
    expect(record?.failure).toEqual({ code: 'RULE_READ_FAILED', message: 'Jev rule read failed' })
    expect(record?.attemptRecords).toHaveLength(0)
    expect(JSON.stringify(record)).not.toContain('private text')
  })

  it('does not adopt a valid background answer after its target changes', async () => {
    const path = await root()
    const http = await fixture([valid])
    const { ctx, agent } = await setup({ root: join(path, 'storage'), profile: join(path, 'profile'), url: http.url })
    ctx.jev.registerFeature({ id: 'fixture', name: 'Fixture', description: 'Test only' })
    const result = await ctx.jev.judgeOnce({ featureId: 'fixture', agent, link: {}, refresh: () => request,
      canAdopt: () => 'Requirements changed' })
    expect(result.kind).toBe('not-adopted')
    expect((await ctx.jev.getRecord(result.operationId!))?.receipts[0]?.status).toBe('not-adopted')
  })

  it('waits for a manual retry and refreshes the second attempt input', async () => {
    const path = await root()
    const bad = { answers: { ...valid.answers, risk: { score: 9 } } }
    const http = await fixture([bad, valid])
    const { ctx, agent } = await setup({ root: join(path, 'storage'), profile: join(path, 'profile'), url: http.url })
    ctx.jev.registerFeature({ id: 'fixture', name: 'Fixture', description: 'Test only' })
    let calls = 0
    let resolveAsk: ((answer: { answers: { id: string; selected: string[] }[] }) => void) | undefined
    const asked = new Promise<void>(resolve => {
      ctx.on('user-questions/request', () => { resolve(); return new Promise(answer => { resolveAsk = answer }) })
    })
    const pending = ctx.jev.judge({ featureId: 'fixture', link: {}, agent,
      refresh: () => ({ ...request, state: { version: ++calls } }),
    })
    await asked
    expect(http.received).toHaveLength(1)
    resolveAsk?.({ answers: [{ id: 'jev-resolution', selected: ['重试 / Retry'] }] })
    const outcome = await pending
    expect(outcome.kind).toBe('ok')
    expect(calls).toBe(2)
    expect(http.received).toMatchObject([{ state: { version: 1 } }, { state: { version: 2 } }])
    if (outcome.kind === 'ok') expect((await ctx.jev.getRecord(outcome.operationId))?.attemptRecords).toHaveLength(2)
  })

  it('cancels a pending manual answer without sending a retry', async () => {
    const path = await root()
    const http = await fixture([{ answers: {} }])
    const { ctx, agent } = await setup({ root: join(path, 'storage'), profile: join(path, 'profile'), url: http.url })
    ctx.jev.registerFeature({ id: 'fixture', name: 'Fixture', description: 'Test only' })
    const controller = new AbortController()
    let askReady: (() => void) | undefined
    const asked = new Promise<void>(resolve => { askReady = resolve })
    ctx.on('user-questions/request', () => { askReady?.(); return new Promise(() => {}) })
    const pending = ctx.jev.judge({ featureId: 'fixture', link: {}, agent, refresh: () => request, signal: controller.signal })
    await asked
    controller.abort()
    const outcome = await pending
    expect(outcome.kind).toBe('cancelled')
    expect(http.received).toHaveLength(1)
    if (outcome.kind === 'cancelled') expect((await ctx.jev.getRecord(outcome.operationId))?.status).toBe('cancelled')
  })

  it('asks for enablement after a manual retry when the feature was disabled during the wait', async () => {
    const path = await root()
    const http = await fixture([{ answers: {} }])
    const { ctx, agent, features } = await setup({ root: join(path, 'storage'), profile: join(path, 'profile'), url: http.url })
    ctx.jev.registerFeature({ id: 'fixture', name: 'Fixture', description: 'Test only' })
    let prompts = 0
    ctx.on('user-questions/request', () => {
      prompts += 1
      if (prompts === 1) {
        updateVolatile(features, createVolatile({ fixture: false }))
        return Promise.resolve({ answers: [{ id: 'jev-resolution', selected: ['重试 / Retry'] }] })
      }
      return Promise.resolve({ answers: [{ id: 'jev-resolution', selected: ['取消 / Cancel'] }] })
    })
    const outcome = await ctx.jev.judge({ featureId: 'fixture', link: {}, agent, refresh: () => request })
    expect(outcome.kind).toBe('cancelled')
    expect(prompts).toBe(2)
    expect(http.received).toHaveLength(1)
  })

  it('allows an already sent judgment to finish after disablement and rejects a later call', async () => {
    const path = await root()
    let entered: (() => void) | undefined
    const sent = new Promise<void>(resolve => { entered = resolve })
    let release: ((value: object) => void) | undefined
    const answer = new Promise<object>(resolve => { release = resolve })
    const http = await fixture([() => { entered?.(); return answer }])
    const { ctx, agent, features } = await setup({ root: join(path, 'storage'), profile: join(path, 'profile'), url: http.url })
    ctx.jev.registerFeature({ id: 'fixture', name: 'Fixture', description: 'Test only' })
    const pending = ctx.jev.judge({ featureId: 'fixture', link: {}, agent, refresh: () => request })
    await sent
    updateVolatile(features, createVolatile({ fixture: false }))
    release?.(valid)
    expect((await pending).kind).toBe('ok')
    await expect(ctx.jev.judge({ featureId: 'fixture', link: {}, agent, refresh: () => request }))
      .rejects.toMatchObject({ code: 'FEATURE_DISABLED' })
    expect(http.received).toHaveLength(1)
  })

  it('does not dispatch when a feature turns off during asynchronous input refresh', async () => {
    const path = await root()
    const http = await fixture([valid])
    const { ctx, agent, features } = await setup({ root: join(path, 'storage'), profile: join(path, 'profile'), url: http.url })
    ctx.jev.registerFeature({ id: 'fixture', name: 'Fixture', description: 'Test only' })
    let refreshStarted: (() => void) | undefined
    const refreshing = new Promise<void>(resolve => { refreshStarted = resolve })
    let returnInput: ((value: JevRequest) => void) | undefined
    const input = new Promise<JevRequest>(resolve => { returnInput = resolve })
    ctx.on('user-questions/request', () => Promise.resolve({ answers: [{ id: 'jev-resolution', selected: ['取消 / Cancel'] }] }))
    const pending = ctx.jev.judge({ featureId: 'fixture', link: {}, agent,
      refresh: () => { refreshStarted?.(); return input },
    })
    await refreshing
    updateVolatile(features, createVolatile({ fixture: false }))
    returnInput?.(request)
    expect((await pending).kind).toBe('cancelled')
    expect(http.received).toHaveLength(0)
  })

  it('runs a fixed diagnostic while every business feature is disabled', async () => {
    const path = await root()
    const http = await fixture([valid])
    const profile = join(path, 'profile')
    const storage = join(path, 'storage')
    const { ctx, dispose } = await setup({ root: storage, profile, url: http.url, enabled: false })
    const result = await ctx.jev.testConnection(ctx.jev.judgmentConnectionIdentity(), new AbortController().signal)
    expect(result.ok).toBe(true)
    expect(http.received[0]).toMatchObject({ state: { diagnostic: 'jev-connection-test' }, questions: { ready: { type: 'noul' } } })
    expect(await ctx.jev.getRecord(result.recordId)).toMatchObject({ diagnostic: true, status: 'succeeded' })
    await dispose()
    const backend = new JsonStorageBackend(storage)
    const readCtx = new Context()
    await readCtx.plugin(Storage)
    readCtx.storage.backend.register('json', backend)
    const ledger = await JevLedger.open(new DomainFacility(readCtx, { backend: 'json' }), profile)
    expect(ledger.get(result.recordId)?.actionStatus).toBeUndefined()
    await ledger.close()
    await backend.close()
    await readCtx.fiber.dispose()
  })

  it('classifies a local service timeout and never retries without a human answer', async () => {
    const path = await root()
    let entered: (() => void) | undefined
    const sent = new Promise<void>(resolve => { entered = resolve })
    let release: ((value: object) => void) | undefined
    const answer = new Promise<object>(resolve => { release = resolve })
    const http = await fixture([() => { entered?.(); return answer }])
    const { ctx, agent } = await setup({ root: join(path, 'storage'), profile: join(path, 'profile'), url: http.url, timeoutMs: 30 })
    ctx.jev.registerFeature({ id: 'fixture', name: 'Fixture', description: 'Test only' })
    const deadline = new AbortController()
    const clock = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
    try {
      const pending = ctx.jev.judge({ featureId: 'fixture', link: {}, agent, refresh: () => request })
        .then(result => ({ result, error: undefined }), error => ({ result: undefined, error }))
      await sent
      expect(clock).toHaveBeenCalledExactlyOnceWith(30)
      deadline.abort()
      expect((await pending).error).toMatchObject({ code: 'NO_INTERFACE' })
      expect(http.received).toHaveLength(1)
      expect((await ctx.jev.listRecords({})).items[0]?.status).toBe('failed')
      const id = (await ctx.jev.listRecords({})).items[0]?.id
      if (id !== undefined) expect((await ctx.jev.getRecord(id))?.attemptRecords[0]?.failure?.code).toBe('TIMEOUT')
    } finally { clock.mockRestore(); release?.(valid) }
  })

  it('drains a waiting operation on Host disposal and persists cancellation', async () => {
    const path = await root()
    const http = await fixture([{ answers: {} }])
    const profile = join(path, 'profile')
    const storage = join(path, 'storage')
    const { ctx, agent, dispose } = await setup({ root: storage, profile, url: http.url })
    ctx.jev.registerFeature({ id: 'fixture', name: 'Fixture', description: 'Test only' })
    let reached: (() => void) | undefined
    const asked = new Promise<void>(resolve => { reached = resolve })
    ctx.on('user-questions/request', () => { reached?.(); return new Promise(() => {}) })
    const pending = ctx.jev.judge({ featureId: 'fixture', link: {}, agent, refresh: () => request })
    await asked
    const stopping = dispose()
    const outcome = await pending
    await stopping
    expect(outcome.kind).toBe('cancelled')
    const backend = new JsonStorageBackend(storage)
    const readCtx = new Context()
    await readCtx.plugin(Storage)
    readCtx.storage.backend.register('json', backend)
    const ledger = await JevLedger.open(new DomainFacility(readCtx, { backend: 'json' }), profile)
    if (outcome.kind === 'cancelled') expect(ledger.get(outcome.operationId)?.status).toBe('cancelled')
    await ledger.close()
    await backend.close()
    await readCtx.fiber.dispose()
  })

  it('marks a pending file-backed attempt interrupted on reopen', async () => {
    const path = await root()
    const profile = join(path, 'profile')
    const backend = new JsonStorageBackend(join(path, 'storage'))
    const ctx = new Context()
    await ctx.plugin(Storage)
    ctx.storage.backend.register('json', backend)
    const facility = new DomainFacility(ctx, { backend: 'json' })
    const ledger = await JevLedger.open(facility, profile)
    const operation = await ledger.create('fixture', { sessionId: 'fixture-session' })
    await ledger.startAttempt(operation.id, request, { baseUrl: 'http://127.0.0.1:1/', model: 'local', credentialRef: 'JEV_TEST_KEY' })
    await ledger.close()
    const reopened = await JevLedger.open(facility, profile)
    expect(reopened.get(operation.id)).toMatchObject({ status: 'interrupted', attemptRecords: [{ status: 'interrupted' }] })
    await reopened.close()
    await facility.closeAll()
    await backend.close()
    await ctx.fiber.dispose()
  })

  it('fails explicitly without a human answerer and settles the operation', async () => {
    const path = await root()
    const http = await fixture([{ answers: {} }])
    const { ctx, agent } = await setup({ root: join(path, 'storage'), profile: join(path, 'profile'), url: http.url })
    ctx.jev.registerFeature({ id: 'fixture', name: 'Fixture', description: 'Test only' })
    await expect(ctx.jev.judge({ featureId: 'fixture', link: {}, agent, refresh: () => request }))
      .rejects.toMatchObject({ code: 'NO_INTERFACE' })
    expect((await ctx.jev.listRecords({})).items[0]?.status).toBe('failed')
  })

  it('does not treat an empty human reply as cancellation or send another request', async () => {
    const path = await root()
    const http = await fixture([{ answers: {} }])
    const { ctx, agent } = await setup({ root: join(path, 'storage'), profile: join(path, 'profile'), url: http.url })
    ctx.jev.registerFeature({ id: 'fixture', name: 'Fixture', description: 'Test only' })
    ctx.on('user-questions/request', () => Promise.resolve({ answers: [{ id: 'jev-resolution', selected: [] }] }))
    await expect(ctx.jev.judge({ featureId: 'fixture', link: {}, agent, refresh: () => request }))
      .rejects.toMatchObject({ code: 'INVALID_HUMAN_ANSWER' })
    expect(http.received).toHaveLength(1)
    expect((await ctx.jev.listRecords({})).items[0]?.status).toBe('failed')
  })

  it('refuses transport when the durable input write fails', async () => {
    const path = await root()
    const http = await fixture([valid])
    const { ctx, agent } = await setup({ root: join(path, 'storage'), profile: join(path, 'profile'), url: http.url })
    ctx.jev.registerFeature({ id: 'fixture', name: 'Fixture', description: 'Test only' })
    const write = vi.spyOn(JevLedger.prototype, 'startAttempt').mockRejectedValueOnce(new Error('medium refused write'))
    try {
      await expect(ctx.jev.judge({ featureId: 'fixture', link: {}, agent, refresh: () => request }))
        .rejects.toMatchObject({ code: 'LOG_WRITE_FAILED' })
      expect(http.received).toHaveLength(0)
    } finally { write.mockRestore() }
  })

  it('does not expose a valid answer when the result write fails', async () => {
    const path = await root()
    const http = await fixture([valid])
    const { ctx, agent } = await setup({ root: join(path, 'storage'), profile: join(path, 'profile'), url: http.url })
    ctx.jev.registerFeature({ id: 'fixture', name: 'Fixture', description: 'Test only' })
    const write = vi.spyOn(JevLedger.prototype, 'settleAttempt').mockRejectedValueOnce(new Error('medium refused write'))
    try {
      await expect(ctx.jev.judge({ featureId: 'fixture', link: {}, agent, refresh: () => request }))
        .rejects.toMatchObject({ code: 'LOG_WRITE_FAILED' })
      expect(http.received).toHaveLength(1)
      expect((await ctx.jev.listRecords({})).items[0]?.status).toBe('pending')
    } finally { write.mockRestore() }
  })

  it('keeps a pre-write request snapshot even if its producer mutates the input while persistence waits', async () => {
    const path = await root()
    const http = await fixture([valid])
    const { ctx, agent } = await setup({ root: join(path, 'storage'), profile: join(path, 'profile'), url: http.url })
    ctx.jev.registerFeature({ id: 'fixture', name: 'Fixture', description: 'Test only' })
    const state = { version: 1 }
    let reached: (() => void) | undefined
    const writing = new Promise<void>(resolve => { reached = resolve })
    let release: (() => void) | undefined
    const allow = new Promise<void>(resolve => { release = resolve })
    const original = JevLedger.prototype.startAttempt
    const write = vi.spyOn(JevLedger.prototype, 'startAttempt').mockImplementation(async function (id, current, connection) {
      reached?.()
      await allow
      return original.call(this, id, current, connection)
    })
    try {
      const pending = ctx.jev.judge({ featureId: 'fixture', link: {}, agent,
        refresh: () => ({ state, questions: request.questions }),
      })
      await writing
      state.version = 2
      release?.()
      const outcome = await pending
      expect(outcome.kind).toBe('ok')
      expect(http.received[0]).toMatchObject({ state: { version: 1 } })
      if (outcome.kind === 'ok') expect((await ctx.jev.getRecord(outcome.operationId))?.attemptRecords[0]?.request.state)
        .toEqual({ version: 1 })
    } finally { write.mockRestore() }
  })

  it('keeps action receipts idempotent and rejects conflicts and cross-profile ids', async () => {
    const path = await root()
    const http = await fixture([valid])
    const storage = join(path, 'storage')
    const first = await setup({ root: storage, profile: join(path, 'first'), url: http.url })
    first.ctx.jev.registerFeature({ id: 'fixture', name: 'Fixture', description: 'Test only' })
    const outcome = await first.ctx.jev.judge({ featureId: 'fixture', link: {}, agent: first.agent, refresh: () => request })
    if (outcome.kind !== 'ok') throw new Error('expected successful local fixture')
    const receipt = { id: 'action-1', status: 'executed' as const, at: new Date().toISOString() }
    await first.ctx.jev.writeReceipt(outcome.operationId, receipt)
    await first.ctx.jev.writeReceipt(outcome.operationId, receipt)
    expect((await first.ctx.jev.getRecord(outcome.operationId))?.receipts).toHaveLength(1)
    await expect(first.ctx.jev.writeReceipt(outcome.operationId, { ...receipt, status: 'execution-failed' }))
      .rejects.toMatchObject({ code: 'RECEIPT_CONFLICT' })
    const second = await setup({ root: storage, profile: join(path, 'second'), url: http.url })
    expect(await second.ctx.jev.getRecord(outcome.operationId)).toBeNull()
    await expect(second.ctx.jev.writeReceipt(outcome.operationId, receipt))
      .rejects.toMatchObject({ code: 'UNKNOWN_OPERATION' })
  })
})
