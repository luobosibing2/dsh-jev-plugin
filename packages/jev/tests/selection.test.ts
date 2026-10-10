import { spawn as nodeSpawn } from 'node:child_process'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { createVolatile, updateVolatile } from '@deepseek-ai/cosmokit'
import AgentRegistry, { agentEvents, type Agent, type PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createAssistantMessage, createUserMessage, ToolCallId, type UserMessage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { applyGlobTool, applyGrepTool } from '@deepseek-ai/dsh-tool-fs-search'
import * as toolSkill from '@deepseek-ai/dsh-tool-skill'
import * as toolWorkingDirectory from '@deepseek-ai/dsh-tool-working-directory'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { apply, Config } from '../src/selection.ts'
import type { JevJudgeOptions, JevJudgeResult } from '../src/index.ts'
import type { JevActionReceipt, JevRequest } from '../src/types.ts'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const task of cleanup.splice(0).reverse()) await task() })

function subprocess() {
  return {
    spawn(spec: { argv: string[]; cwd: string; signal: AbortSignal }) {
      const child = nodeSpawn(spec.argv[0]!, spec.argv.slice(1), { cwd: spec.cwd, signal: spec.signal, stdio: ['ignore', 'pipe', 'pipe'] })
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      child.stdout.on('data', (part: Buffer) => stdout.push(part))
      child.stderr.on('data', (part: Buffer) => stderr.push(part))
      const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
        child.once('error', reject)
        child.once('close', (exitCode, signal) => resolve({ exitCode, signal }))
      })
      return { done, collected: {
        stdout: { readFrom: () => ({ text: Buffer.concat(stdout).toString('utf8'), lossy: false }) },
        stderr: { readFrom: () => ({ text: Buffer.concat(stderr).toString('utf8'), lossy: false }) },
      } }
    },
  }
}

interface Fixture {
  ctx: Context
  agent: Agent
  root: string
  requests: JevRequest[]
  receipts: JevActionReceipt[]
  enabled: Record<string, boolean>
  settings: { skillLimit: ReturnType<typeof createVolatile<number>>; fileCandidates: ReturnType<typeof createVolatile<number>>; fileLimit: ReturnType<typeof createVolatile<number>> }
  judge: ReturnType<typeof vi.fn<(options: JevJudgeOptions) => Promise<JevJudgeResult>>>
}

async function fixture(counts = { skillLimit: 1, fileCandidates: 40, fileLimit: 1 }, withSpill = true): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'jev-selection-hook-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalFileSystem, { cwd: root })
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(WorkingDirectory)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(toolSkill)
  ctx.provide('subprocess', subprocess() as never)
  ctx.provide('settings', { configure: () => () => {} } as never)
  if (withSpill) ctx.provide('spillStore', { saveText: async () => ({
    locator: 'saved/jev-glob-ranked.txt', retrievalHint: 'Read this file for all scored paths.', bytes: 64,
  }) } as never)
  const requests: JevRequest[] = []
  const receipts: JevActionReceipt[] = []
  const enabled = { 'skill-selection': true, 'file-ranking': true }
  const judge = vi.fn(async (options: JevJudgeOptions): Promise<JevJudgeResult> => {
    const request = await options.refresh(options.signal ?? new AbortController().signal)
    requests.push(request)
    return { kind: 'ok', operationId: 'operation-' + requests.length, attemptId: 'attempt', response: {
      answers: request.questions.map((question, index) => ({
        id: question.id, kind: 'noul', probability: index === 0 ? 0.1 : 0.9,
      })),
    } }
  })
  ctx.provide('jev', {
    registerFeature: () => () => {},
    listFeatures: async () => Object.entries(enabled).map(([id, on]) => ({ id, enabled: on })),
    judge,
    writeReceipt: async (_operationId: string, receipt: JevActionReceipt) => { receipts.push(receipt) },
  } as never)
  const settings = {
    skillLimit: createVolatile(counts.skillLimit),
    fileCandidates: createVolatile(counts.fileCandidates),
    fileLimit: createVolatile(counts.fileLimit),
  }
  apply(ctx, settings)
  applyGlobTool(ctx, { sampleOverCapGlobResults: false, maxResults: 100, maxMetaBytes: 65_536,
    rawOutputMaxBytes: 20_000_000, graceMs: 3_000, stderrMaxBytes: 64 * 1024, timeoutMs: 30_000 })
  applyGrepTool(ctx, { maxMatches: 100, maxLineBytes: 2_000, maxMetaBytes: 65_536,
    rawOutputMaxBytes: 20_000_000, graceMs: 3_000, stderrMaxBytes: 64 * 1024, timeoutMs: 30_000 })
  const id = SessionId('selection-' + root)
  const session = Session.create(id, undefined, {
    version: SESSION_FORMAT_VERSION, id, createdAt: 0, cwd: root, isSeeded: false,
  })
  const agent = {
    ctx, id, options: {}, session, status: 'running', inbox: {} as Agent['inbox'],
    send: () => {}, followup: () => {}, steer: () => {}, inject: () => {}, cancel: () => {},
    runMaintenance: (task: (signal: AbortSignal) => Promise<unknown>) => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  } as Agent
  ctx.agents.enter(agent, undefined)
  cleanup.push(async () => { await ctx.fiber.dispose() })
  return { ctx, agent, root, requests, receipts, enabled, judge, settings }
}

function user(text: string): UserMessage {
  return createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
}

async function step(
  ctx: Context, agent: Agent, pending: UserMessage[] = [], recorded?: SessionEvent[],
): Promise<PreStepDecision> {
  const result = await agentEvents(ctx, agent).waterfall('agent/pre-step',
    { messages: pending, turn: 1, step: 1, signal: new AbortController().signal },
    () => Promise.resolve({ kind: 'enter' as const, messages: pending }))
  if (result.kind === 'enter') {
    for (const message of result.messages) {
      const event = agent.session.append('user/message', message, { surfaceOp: 'append' })
      recorded?.push(event)
    }
  }
  return result
}

let call = 0
async function invoke(ctx: Context, agent: Agent, name: string, args: object) {
  return ctx.agents.withInitiator(agent, () => ctx.tools.execute({
    name, arguments: args, agent, signal: new AbortController().signal, callId: ToolCallId('selection-' + ++call),
  }))
}

describe('selection hooks through host plugin paths', () => {
  it('validates counts and publishes partial skill summaries with recovery on each new user request', async () => {
    expect(() => Config({ skillLimit: 0, fileCandidates: 40, fileLimit: 12 })).toThrow()
    const { ctx, agent, requests } = await fixture()
    ctx.skills.register({ name: 'alpha', description: 'Alpha summary', source: 'runtime', content: 'ALPHA BODY' })
    ctx.skills.register({ name: 'beta', description: 'Beta summary', source: 'runtime', content: 'BETA BODY' })
    ctx.skills.register({ name: 'private', description: 'Private summary', source: 'runtime', content: 'PRIVATE BODY',
      invocation: { modelInvocable: false, userInvocable: true } })
    const first = await step(ctx, agent, [user('Need the beta skill')])
    expect(first.kind).toBe('enter')
    if (first.kind !== 'enter') return
    const selected = first.messages.find(message => message.source.kind === 'jev-skill-catalog')
    const text = selected?.content[0]?.type === 'text' ? selected.content[0].text : ''
    expect(text).toMatchInlineSnapshot(`"<system-reminder>\nJev selected the top 1 of 2 model-invocable skills. These 1 new summaries supplement the catalogs already visible in this session. Probabilities estimate relevance, not task success.\n<available_skills>\n- beta: Beta summary (relevance probability 0.9)\n</available_skills>\nCall the skill tool with an exact name before following its instructions. This is a partial catalog; call skill_catalog to see every currently model-invocable skill summary. A user may invoke an eligible skill directly.\n</system-reminder>"`)
    expect(JSON.stringify(requests)).not.toContain('BODY')
    const ordinary = await step(ctx, agent)
    expect(ordinary.kind === 'enter' && ordinary.messages.some(message => message.source.kind === 'skill-catalog')).toBe(false)
    expect(requests).toHaveLength(1)
    const all = await invoke(ctx, agent, 'skill_catalog', {})
    expect(all.isError).toBe(false)
    if (!all.isError) expect(all.value).toEqual({ skills: [
      { name: 'alpha', description: 'Alpha summary' }, { name: 'beta', description: 'Beta summary' },
    ] })
    const loaded = await invoke(ctx, agent, 'skill', { name: 'alpha' })
    expect(loaded.isError).toBe(false)
    await step(ctx, agent, [user('Now alpha')])
    expect(requests).toHaveLength(2)
  })

  it('reselects on directory change, while disabled and no context preserve the host catalog', async () => {
    const { ctx, agent, requests, enabled } = await fixture()
    ctx.skills.register({ name: 'alpha', description: 'A', source: 'runtime', content: 'body' })
    await step(ctx, agent, [user('Find skill')])
    expect(requests).toHaveLength(1)
    ctx.skills.register({ name: 'beta', description: 'B', source: 'runtime', content: 'body' })
    await step(ctx, agent)
    expect(requests).toHaveLength(2)
    enabled['skill-selection'] = false
    const host = await step(ctx, agent)
    expect(host.kind === 'enter' && host.messages.some(message => message.source.kind === 'skill-catalog')).toBe(true)
    enabled['skill-selection'] = true
    await step(ctx, agent)
    expect(requests).toHaveLength(3)
    const noContext = await fixture()
    noContext.ctx.skills.register({ name: 'alpha', description: 'A', source: 'runtime', content: 'body' })
    const original = await step(noContext.ctx, noContext.agent)
    expect(original.kind === 'enter' && original.messages.some(message => message.source.kind === 'skill-catalog')).toBe(true)
    expect(noContext.requests).toHaveLength(0)
  })

  it('selects skills from the current directory after the native working_directory tool changes it', async () => {
    const { ctx, agent, root, requests } = await fixture()
    await mkdir(join(root, 'changed'))
    const changed = await realpath(join(root, 'changed'))
    ctx.skills.registerProvider(() => ({
      name: 'directory-fixture',
      list: async ({ cwd }) => [{
        name: cwd === changed ? 'changed-skill' : 'original-skill',
        description: cwd === changed ? 'Changed directory skill' : 'Original directory skill',
        invocation: { modelInvocable: true, userInvocable: true }, source: 'custom',
        provider: 'directory-fixture', rank: 0, locator: cwd,
      }],
      get: async () => undefined,
    }))
    await ctx.plugin(toolWorkingDirectory)
    await step(ctx, agent, [user('Choose a skill for the current directory')])
    expect(JSON.stringify(requests[0])).toContain('original-skill')
    const moved = await invoke(ctx, agent, 'working_directory', { cd: 'changed' })
    expect(moved.isError).toBe(false)
    expect(moved.value).toEqual({ cwd: changed })
    expect(agent.session.header.cwd).toBe(root)
    const next = await step(ctx, agent)
    expect(requests).toHaveLength(2)
    expect(JSON.stringify(requests[1])).toContain('changed-skill')
    expect(JSON.stringify(requests[1])).not.toContain('original-skill')
    const catalog = next.kind === 'enter' ? next.messages.find(message => message.source.kind === 'jev-skill-catalog') : undefined
    expect(catalog?.source).toMatchObject({ entries: [{ name: 'changed-skill', description: 'Changed directory skill' }] })
    const full = await invoke(ctx, agent, 'skill_catalog', {})
    expect(full.value).toEqual({ skills: [{ name: 'changed-skill', description: 'Changed directory skill' }] })
  })

  it('ranks the original glob output twice, preserves the structured paths and reports omitted results', async () => {
    const { ctx, agent, root, requests } = await fixture()
    await writeFile(join(root, 'alpha.ts'), '')
    await writeFile(join(root, 'beta.ts'), '')
    await step(ctx, agent, [user('Find beta source')])
    const first = await invoke(ctx, agent, 'glob', { pattern: '*.ts' })
    expect(first.isError).toBe(false)
    if (first.isError) return
    expect(first.value).toEqual({ root: '.', paths: ['beta.ts', 'alpha.ts'] })
    const rendered = first.content[0]?.type === 'text' ? first.content[0].text : ''
    expect(rendered).toMatchInlineSnapshot(`"0.9 beta.ts\nJev evaluated 2 of 2 candidate paths; showing 1; omitted 1. Scores estimate path relevance only.\nFull ranked result stored at: saved/jev-glob-ranked.txt. Read this file for all scored paths."`)
    expect(first.additionalContexts).toBeUndefined()
    await invoke(ctx, agent, 'glob', { pattern: '*.ts' })
    expect(requests.filter(request => request.state !== null && typeof request.state === 'object'
      && 'pattern' in request.state)).toHaveLength(2)
  })

  it('skips Jev above the match cap and on empty results without changing glob output', async () => {
    const { ctx, agent, root, requests } = await fixture({ skillLimit: 1, fileCandidates: 1, fileLimit: 1 })
    await writeFile(join(root, 'alpha.ts'), '')
    await writeFile(join(root, 'beta.ts'), '')
    await step(ctx, agent, [user('Find file')])
    const before = requests.length
    const many = await invoke(ctx, agent, 'glob', { pattern: '*.ts' })
    expect(many.isError).toBe(false)
    expect(many.additionalContexts).toBeUndefined()
    expect(many.content[0]).toMatchObject({ type: 'text' })
    expect(requests).toHaveLength(before)
    const empty = await invoke(ctx, agent, 'glob', { pattern: '*.none' })
    expect(empty.isError).toBe(false)
    expect(requests).toHaveLength(before)
  })

  it('bounds newest user and visible assistant text to 2000 characters', async () => {
    const { ctx, agent, requests } = await fixture()
    ctx.skills.register({ name: 'alpha', description: 'A', source: 'runtime', content: 'BODY SECRET' })
    agent.session.append('user/message', user('old-user-' + 'o'.repeat(2_500)), { surfaceOp: 'append' })
    agent.session.append('assistant/message', {
      turn: 1, step: 1,
      message: createAssistantMessage({ source: { provider: 'test', model: 'test' },
        content: [{ type: 'reasoning', text: 'REASONING SECRET' }, { type: 'text', text: 'a'.repeat(1_500) }] }),
      stream: [],
    }, { surfaceOp: 'append' })
    await step(ctx, agent, [user('u'.repeat(800))])
    const context = (requests[0]?.state as { context: { role: string; text: string }[] }).context
    expect(context.map(item => item.role)).toEqual(['assistant', 'user'])
    expect(context.reduce((total, item) => total + item.text.length, 0)).toBe(2_000)
    expect(JSON.stringify(requests[0])).not.toContain('SECRET')
    expect(JSON.stringify(requests[0])).not.toContain('old-user')
  })

  it('returns original glob results if the candidate cap falls during manual retry', async () => {
    const { ctx, agent, root, requests, judge, settings } = await fixture({ skillLimit: 1, fileCandidates: 2, fileLimit: 1 })
    await writeFile(join(root, 'alpha.ts'), '')
    await writeFile(join(root, 'beta.ts'), '')
    await step(ctx, agent, [user('Find source file')])
    judge.mockImplementationOnce(async options => {
      requests.push(await options.refresh(options.signal ?? new AbortController().signal))
      updateVolatile(settings.fileCandidates, createVolatile(1))
      await options.refresh(options.signal ?? new AbortController().signal)
      throw new Error('Expected cap check to stop retry')
    })
    const result = await invoke(ctx, agent, 'glob', { pattern: '*.ts' })
    expect(result.isError).toBe(false)
    if (result.isError) return
    expect((result.value as { paths: string[] }).paths).toHaveLength(2)
    expect(result.content[0]?.type === 'text' && result.content[0].text).not.toContain('Jev evaluated')
    expect(requests).toHaveLength(1)
  })

  it('keeps explicit user skill invocation on the original loader path', async () => {
    const { ctx, agent, requests } = await fixture()
    ctx.skills.register({ name: 'alpha', description: 'Alpha', source: 'runtime', content: 'Alpha full instructions' })
    const result = await step(ctx, agent, [user('/alpha use this skill')])
    expect(result.kind).toBe('enter')
    if (result.kind !== 'enter') return
    const instruction = result.messages.find(message => message.source.kind === 'skill-invocation')
    expect(instruction?.content[0]?.type === 'text' && instruction.content[0].text).toContain('Alpha full instructions')
    expect(requests).toHaveLength(1)
  })

  it('keeps low relevance probabilities and shows confidence only when supplied', async () => {
    const { ctx, agent, judge, requests } = await fixture({ skillLimit: 2, fileCandidates: 40, fileLimit: 12 })
    ctx.skills.register({ name: 'alpha', description: 'Alpha', source: 'runtime', content: 'Body A' })
    ctx.skills.register({ name: 'beta', description: 'Beta', source: 'runtime', content: 'Body B' })
    judge.mockImplementationOnce(async options => {
      const request = await options.refresh(options.signal ?? new AbortController().signal)
      requests.push(request)
      return { kind: 'ok', operationId: 'low-scores', attemptId: 'attempt', response: {
        answers: [
          { id: request.questions[0]!.id, kind: 'noul', probability: 0.01, confidence: 0.8 },
          { id: request.questions[1]!.id, kind: 'noul', probability: 0 },
        ],
      } }
    })
    const decision = await step(ctx, agent, [user('Find a relevant skill')])
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') return
    const catalog = decision.messages.find(message => message.source.kind === 'jev-skill-catalog')
    const text = catalog?.content[0]?.type === 'text' ? catalog.content[0].text : ''
    expect(text).toContain('alpha: Alpha (relevance probability 0.01, confidence 0.8)')
    expect(text).toContain('beta: Beta (relevance probability 0)')
    expect(text.match(/confidence/g)).toHaveLength(1)
    expect(requests).toHaveLength(1)
  })

  it('uses Jev at 40 glob matches and keeps the original result at 41', async () => {
    const { ctx, agent, root, requests } = await fixture({ skillLimit: 1, fileCandidates: 40, fileLimit: 12 })
    for (let index = 0; index < 40; index++) await writeFile(join(root, 'file-' + index + '.ts'), '')
    await step(ctx, agent, [user('Find relevant source')])
    const forty = await invoke(ctx, agent, 'glob', { pattern: '*.ts' })
    expect(forty.isError).toBe(false)
    expect(requests).toHaveLength(1)
    expect(requests[0]?.questions).toHaveLength(40)
    await writeFile(join(root, 'file-40.ts'), '')
    const fortyOne = await invoke(ctx, agent, 'glob', { pattern: '*.ts' })
    expect(fortyOne.isError).toBe(false)
    expect(requests).toHaveLength(1)
    if (fortyOne.isError) return
    expect((fortyOne.value as { paths: string[] }).paths).toHaveLength(41)
    expect(fortyOne.content[0]?.type === 'text' && fortyOne.content[0].text).not.toContain('Jev evaluated')
  })

  it('leaves glob unchanged when disabled, without context, or called by a child; grep never selects', async () => {
    const { ctx, agent, root, requests, enabled } = await fixture()
    await writeFile(join(root, 'alpha.ts'), 'needle\n')
    const noContext = await invoke(ctx, agent, 'glob', { pattern: '*.ts' })
    expect(noContext.isError).toBe(false)
    expect(requests).toHaveLength(0)
    await step(ctx, agent, [user('Find alpha')])
    enabled['file-ranking'] = false
    const disabled = await invoke(ctx, agent, 'glob', { pattern: '*.ts' })
    expect(disabled.isError).toBe(false)
    expect(requests).toHaveLength(0)
    enabled['file-ranking'] = true
    const grep = await invoke(ctx, agent, 'grep', { pattern: 'needle' })
    expect(grep.isError).toBe(false)
    expect(requests).toHaveLength(0)
    const childId = SessionId('child-' + root)
    const childSession = Session.create(childId, [], {
      version: SESSION_FORMAT_VERSION, id: childId, createdAt: 0, cwd: root, isSeeded: false,
    })
    childSession.append('user/message', user('Find alpha'), { surfaceOp: 'append' })
    const child = { ...agent, id: childId, session: childSession } as Agent
    ctx.agents.enter(child, agent)
    const childResult = await invoke(ctx, child, 'glob', { pattern: '*.ts' })
    expect(childResult.isError).toBe(false)
    expect(requests).toHaveLength(0)
  })

  it('shows every scored path inline when complete-result storage is unavailable', async () => {
    const { ctx, agent, root } = await fixture({ skillLimit: 1, fileCandidates: 40, fileLimit: 1 }, false)
    await writeFile(join(root, 'alpha.ts'), '')
    await writeFile(join(root, 'beta.ts'), '')
    await step(ctx, agent, [user('Find beta')])
    const output = await invoke(ctx, agent, 'glob', { pattern: '*.ts' })
    expect(output.isError).toBe(false)
    if (output.isError) return
    const text = output.content[0]?.type === 'text' ? output.content[0].text : ''
    expect(text).toContain('0.9 beta.ts')
    expect(text).toContain('0.1 alpha.ts')
    expect(text).toContain('showing 2; omitted 0')
    expect(text).toContain('Complete ranked list shown inline because result storage is unavailable.')
  })

  it('adds only new top-ranked skill names across requests and records all-repeat as no publication', async () => {
    const { ctx, agent, judge, requests, receipts } = await fixture({ skillLimit: 3, fileCandidates: 40, fileLimit: 12 })
    for (const name of ['alpha', 'beta', 'gamma', 'delta']) {
      ctx.skills.register({ name, description: name + ' summary', source: 'runtime', content: name + ' body' })
    }
    judge.mockImplementation(async options => {
      const request = await options.refresh(options.signal ?? new AbortController().signal)
      requests.push(request)
      const order = requests.length === 1
        ? ['alpha', 'beta', 'gamma', 'delta']
        : ['beta', 'gamma', 'delta', 'alpha']
      return { kind: 'ok', operationId: 'selection-' + requests.length, attemptId: 'attempt', response: {
        answers: request.questions.map(question => {
          const name = String(question.prompt).match(/Skill: ([^.]+)\./)?.[1]
          const position = order.indexOf(name ?? '')
          return { id: question.id, kind: 'noul', probability: position < 0 ? 0 : (4 - position) / 5 }
        }),
      } }
    })
    const first = await step(ctx, agent, [user('First request')])
    const firstCatalog = first.kind === 'enter' ? first.messages.find(message => message.source.kind === 'jev-skill-catalog') : undefined
    expect(firstCatalog?.source.kind === 'jev-skill-catalog' && firstCatalog.source.entries.map(entry => entry.name))
      .toEqual(['alpha', 'beta', 'gamma'])
    const second = await step(ctx, agent, [user('Second request')])
    const secondCatalog = second.kind === 'enter' ? second.messages.find(message => message.source.kind === 'jev-skill-catalog') : undefined
    expect(secondCatalog?.source.kind === 'jev-skill-catalog' && secondCatalog.source.entries.map(entry => entry.name))
      .toEqual(['delta'])
    const secondText = secondCatalog?.content[0]?.type === 'text' ? secondCatalog.content[0].text : ''
    expect(secondText).toContain('These 1 new summaries supplement the catalogs already visible')
    expect(secondText).not.toContain('alpha:')
    const third = await step(ctx, agent, [user('Third request')])
    expect(third.kind === 'enter' && third.messages.some(message => message.source.kind === 'jev-skill-catalog')).toBe(false)
    expect(requests).toHaveLength(3)
    expect(receipts.map(item => item.id)).toEqual([
      'skill-catalog-published', 'skill-catalog-published', 'skill-catalog-no-new',
    ])
    ctx.skills.register({ name: 'epsilon', description: 'E summary', source: 'runtime', content: 'E body' })
    const fourth = await step(ctx, agent)
    expect(fourth.kind === 'enter' && fourth.messages.some(message => message.source.kind === 'jev-skill-catalog')).toBe(false)
    expect(requests).toHaveLength(4)
    await step(ctx, agent)
    expect(requests).toHaveLength(4)
  })

  it('counts only visible native and Jev catalogs, not ordinary mentions, and allows a removed summary again', async () => {
    const { ctx, agent, requests } = await fixture({ skillLimit: 2, fileCandidates: 40, fileLimit: 12 })
    ctx.skills.register({ name: 'alpha', description: 'Alpha', source: 'runtime', content: 'Body A' })
    ctx.skills.register({ name: 'beta', description: 'Beta', source: 'runtime', content: 'Body B' })
    agent.session.append('user/message', createUserMessage({
      source: { kind: 'skill-catalog', form: 'catalog', entries: [{ name: 'alpha', description: 'Alpha' }] },
      content: [{ type: 'text', text: 'Native catalog: alpha' }],
    }), { surfaceOp: 'append' })
    const first = await step(ctx, agent, [user('beta and alpha')])
    const catalog = first.kind === 'enter' ? first.messages.find(message => message.source.kind === 'jev-skill-catalog') : undefined
    expect(catalog?.source.kind === 'jev-skill-catalog' && catalog.source.entries.map(entry => entry.name)).toEqual(['beta'])
    expect(requests).toHaveLength(1)
    const catalogSeq = agent.session.surface.nodes.at(-1)!
    agent.session.append('user/message', user('Compacted request history'), {
      surfaceOp: { op: 'replace', startSeq: catalogSeq, endSeq: catalogSeq },
      sourceEventSeqs: [catalogSeq],
    })
    const afterReplacement = await step(ctx, agent)
    const refreshed = afterReplacement.kind === 'enter'
      ? afterReplacement.messages.find(message => message.source.kind === 'jev-skill-catalog') : undefined
    expect(refreshed?.source.kind === 'jev-skill-catalog' && refreshed.source.entries.map(entry => entry.name)).toEqual(['beta'])
    expect(requests).toHaveLength(2)
  })

  it('rebuilds visible-name deduplication for replayed Sessions and isolates a fresh Session', async () => {
    const { ctx, agent, root, requests } = await fixture()
    ctx.skills.register({ name: 'alpha', description: 'Alpha', source: 'runtime', content: 'Body A' })
    const recorded: SessionEvent[] = []
    await step(ctx, agent, [user('alpha')], recorded)
    const replayId = SessionId('replay-' + root)
    const replaySession = Session.create(replayId, recorded, {
      version: SESSION_FORMAT_VERSION, id: replayId, createdAt: 0, cwd: root, isSeeded: false,
    })
    const replayAgent = { ...agent, id: replayId, session: replaySession } as Agent
    ctx.agents.enter(replayAgent, undefined)
    const replayDecision = await step(ctx, replayAgent, [user('alpha again')])
    expect(replayDecision.kind === 'enter'
      && replayDecision.messages.some(message => message.source.kind === 'jev-skill-catalog')).toBe(false)
    expect(requests).toHaveLength(2)
    const freshId = SessionId('fresh-' + root)
    const freshSession = Session.create(freshId, [], {
      version: SESSION_FORMAT_VERSION, id: freshId, createdAt: 0, cwd: root, isSeeded: false,
    })
    const freshAgent = { ...agent, id: freshId, session: freshSession } as Agent
    ctx.agents.enter(freshAgent, undefined)
    const freshDecision = await step(ctx, freshAgent, [user('alpha')])
    expect(freshDecision.kind === 'enter'
      && freshDecision.messages.some(message => message.source.kind === 'jev-skill-catalog')).toBe(true)
    expect(requests).toHaveLength(3)
  })
})
