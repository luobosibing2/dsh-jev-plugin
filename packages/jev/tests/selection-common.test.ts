import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { createVolatile, updateVolatile } from '@deepseek-ai/cosmokit'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import LlmRuntime, { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SessionStore from '@deepseek-ai/dsh-session'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import Storage from '@deepseek-ai/dsh-storage'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import {
  applyGlobTool, GLOB_MAX_RESULTS, RAW_OUTPUT_MAX_BYTES, SEARCH_GRACE_MS,
  SEARCH_META_MAX_BYTES, SEARCH_STDERR_MAX_BYTES, SEARCH_TIMEOUT_MS,
} from '@deepseek-ai/dsh-tool-fs-search'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import JevService from '../src/index.ts'
import { apply } from '../src/selection.ts'

type Reply = { status: number; body: object }
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function localJev(replies: Reply[]) {
  const received: object[] = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    received.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as object)
    const reply = replies.shift() ?? { status: 500, body: {} }
    response.writeHead(reply.status, { 'content-type': 'application/json' })
    response.end(JSON.stringify(reply.body))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Local Jev fixture has no port')
  cleanups.push(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())))
  return { url: `http://127.0.0.1:${address.port}/v1/systemone`, received }
}

async function setup(url: string) {
  const root = await mkdtemp(join(tmpdir(), 'jev-selection-common-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  await ctx.plugin(Storage)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LocalFileSystem, { cwd: root })
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(WorkingDirectory)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(UserQuestionService)
  const backend = new JsonStorageBackend(join(root, 'storage'))
  const unregister = ctx.storage.backend.register('json', backend)
  const facility = new DomainFacility(ctx, { backend: 'json' })
  ctx.provide('storageDomain', facility)
  ctx.provide('profileContext', { dir: join(root, 'profile') } as never)
  ctx.provide('settings', { configure: () => () => {} } as never)
  ctx.provide('credentials', {
    resolve: async () => ({ value: 'local-test-key', source: 'fixture' }),
    describe: async () => ({ configured: true, writable: true, source: 'fixture' }),
    set: async () => {},
  } as never)
  ctx.provide('subprocess', {
    spawn() {
      return {
        done: Promise.resolve({ exitCode: 0, signal: null }),
        collected: {
          stdout: { readFrom: () => ({ text: 'b.ts\na.ts\n', lossy: false }) },
          stderr: { readFrom: () => ({ text: '', lossy: false }) },
        },
      }
    },
  } as never)
  const spills: string[] = []
  ctx.provide('spillStore', { saveText: async ({ content }: { content: string }) => {
    spills.push(content)
    return { locator: 'spill://jev-selection-common', bytes: content.length, retrievalHint: 'read this locator' }
  } } as never)
  await ctx.plugin(JevService, {
    baseUrl: url, model: 'jev-local', credentialRef: 'JEV_TEST_KEY', timeoutMs: 10_000,
    features: { 'skill-selection': false, 'file-ranking': true },
  })
  applyGlobTool(ctx, {
    sampleOverCapGlobResults: false, maxResults: GLOB_MAX_RESULTS,
    maxMetaBytes: SEARCH_META_MAX_BYTES, rawOutputMaxBytes: RAW_OUTPUT_MAX_BYTES,
    graceMs: SEARCH_GRACE_MS, stderrMaxBytes: SEARCH_STDERR_MAX_BYTES,
    timeoutMs: SEARCH_TIMEOUT_MS,
  })
  const fileLimit = createVolatile(1)
  apply(ctx, { skillLimit: createVolatile(5), fileCandidates: createVolatile(40), fileLimit })
  const session = ctx.sessions.create(SessionId('jev-selection-common'), { meta: { cwd: root } })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Find the relevant TypeScript file' }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  const agent = { ctx, id: session.id, session } as Agent
  ctx.agents.enter(agent, undefined)
  cleanups.push(async () => {
    await ctx.fiber.dispose()
    unregister()
    await facility.closeAll()
    await backend.close()
  })
  const glob = () => ctx.agents.withInitiator(agent, () => ctx.tools.execute({
    name: 'glob', arguments: { pattern: '*.ts' }, agent,
    signal: new AbortController().signal, callId: ToolCallId('jev-selection-common-glob'),
  }))
  return { ctx, glob, fileLimit, spills }
}

describe('glob selection with the real Jev service failure flow', () => {
  it('waits after an invalid response, then uses the current display setting on manual retry', async () => {
    const http = await localJev([
      { status: 200, body: { answers: {} } },
      { status: 200, body: { answers: {
        'candidate-0': { noul: 0.1 }, 'candidate-1': { noul: 0.9 },
      } } },
    ])
    const { ctx, glob, fileLimit, spills } = await setup(http.url)
    let answerQuestion: ((value: { answers: { id: string; selected: string[] }[] }) => void) | undefined
    const asked = new Promise<void>(resolve => {
      ctx.on('user-questions/request', () => {
        resolve()
        return new Promise(answer => { answerQuestion = answer })
      })
    })
    const pending = glob()
    await asked
    expect(http.received).toHaveLength(1)
    expect((await ctx.jev.listRecords({})).items[0]?.status).toBe('waiting')
    updateVolatile(fileLimit, createVolatile(2))
    answerQuestion?.({ answers: [{ id: 'jev-resolution', selected: ['重试 / Retry'] }] })
    const result = await pending
    expect(result.isError).toBe(false)
    expect(result.value).toEqual({ root: '.', paths: ['a.ts', 'b.ts'] })
    expect(result.content[0]).toMatchObject({ type: 'text' })
    expect((result.content[0] as { text: string }).text).toContain('showing 2')
    expect(spills).toHaveLength(0)
    expect(http.received).toHaveLength(2)
    expect(http.received[0]).toMatchObject({ state: { pattern: '*.ts' } })
    const id = (await ctx.jev.listRecords({})).items[0]?.id
    if (id === undefined) throw new Error('Jev operation was not recorded')
    expect((await ctx.jev.getRecord(id))?.attemptRecords.map(attempt => attempt.status))
      .toEqual(['failed', 'succeeded'])
  })

  it('keeps a transport failure pending until the user cancels, without releasing glob paths', async () => {
    const http = await localJev([{ status: 503, body: { error: 'local fixture unavailable' } }])
    const { ctx, glob } = await setup(http.url)
    let answerQuestion: ((value: { answers: { id: string; selected: string[] }[] }) => void) | undefined
    const asked = new Promise<void>(resolve => {
      ctx.on('user-questions/request', () => {
        resolve()
        return new Promise(answer => { answerQuestion = answer })
      })
    })
    const pending = glob()
    await asked
    expect(http.received).toHaveLength(1)
    answerQuestion?.({ answers: [{ id: 'jev-resolution', selected: ['取消 / Cancel'] }] })
    const result = await pending
    expect(result.isError).toBe(true)
    expect(result.value).toBeUndefined()
    expect(result.additionalContexts).toBeUndefined()
    expect(JSON.stringify(result.content)).not.toContain('b.ts')
    expect(http.received).toHaveLength(1)
    const id = (await ctx.jev.listRecords({})).items[0]?.id
    if (id === undefined) throw new Error('Jev operation was not recorded')
    expect((await ctx.jev.getRecord(id))?.status).toBe('cancelled')
    expect((await ctx.jev.getRecord(id))?.attemptRecords[0]?.failure?.code).toBe('SERVER')
  })
})
