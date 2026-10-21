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
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import { apply, Config, inject } from '../src/selection.ts'
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
  settings: { skillLimit: ReturnType<typeof createVolatile<number>>; skillMinProbability: ReturnType<typeof createVolatile<number>>; fileCandidates: ReturnType<typeof createVolatile<number>>; fileLimit: ReturnType<typeof createVolatile<number>> }
  judge: ReturnType<typeof vi.fn<(options: JevJudgeOptions) => Promise<JevJudgeResult>>>
}

async function fixture(counts: { skillLimit: number; skillMinProbability?: number; fileCandidates: number; fileLimit: number }
  = { skillLimit: 1, fileCandidates: 40, fileLimit: 1 }, withSpill = true,
  directory: { service?: boolean; sessionCwd?: boolean } = {}, selector = { apply, inject }): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'jev-selection-hook-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalFileSystem, { cwd: root })
  await ctx.plugin(SessionProjectionRegistry)
  if (directory.service !== false) await ctx.plugin(WorkingDirectory)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SkillRegistry)
  if (directory.service !== false) await ctx.plugin(toolSkill)
  else ctx.tools.register(defineTool({ name: 'skill', description: 'Legacy host skill loader marker', parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: () => 'legacy skill loader',
  }))
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
        id: question.id, kind: 'noul', probability: options.featureId === 'file-ranking'
          ? question.prompt === 'Is this path relevant to the task? Path: beta.ts' ? 0.9 : 0.1
          : index === 0 ? 0.6 : 0.9,
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
    skillMinProbability: createVolatile(counts.skillMinProbability ?? 0.5),
    fileCandidates: createVolatile(counts.fileCandidates),
    fileLimit: createVolatile(counts.fileLimit),
  }
  await ctx.plugin({ inject: selector.inject, apply: (pluginCtx: Context) => selector.apply(pluginCtx, settings) })
  applyGlobTool(ctx, { sampleOverCapGlobResults: false, maxResults: 100, maxMetaBytes: 65_536,
    rawOutputMaxBytes: 20_000_000, graceMs: 3_000, stderrMaxBytes: 64 * 1024, timeoutMs: 30_000 })
  applyGrepTool(ctx, { maxMatches: 100, maxLineBytes: 2_000, maxMetaBytes: 65_536,
    rawOutputMaxBytes: 20_000_000, graceMs: 3_000, stderrMaxBytes: 64 * 1024, timeoutMs: 30_000 })
  const id = SessionId('selection-' + root)
  const session = Session.create(id, undefined, {
    version: SESSION_FORMAT_VERSION, id, createdAt: 0,
    ...directory.sessionCwd === false ? {} : { cwd: root }, isSeeded: false,
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

function registerSkills(ctx: Context, names: readonly string[]) {
  for (const name of names) ctx.skills.register({ name, description: name + ' summary', source: 'runtime', content: name + ' body' })
}

function respond(f: Fixture, scores: readonly { probability: number; confidence?: number }[], names?: readonly string[]) {
  f.judge.mockImplementationOnce(async options => {
    const request = await options.refresh(options.signal ?? new AbortController().signal)
    f.requests.push(request)
    return { kind: 'ok', operationId: 'selection-' + f.requests.length, attemptId: 'attempt', response: {
      answers: request.questions.map((question, index) => {
        const name = question.prompt.split('Skill: ')[1]?.split('. Description: ')[0]
        return { id: question.id, kind: 'noul', ...scores[names === undefined ? index : names.indexOf(name ?? '')]! }
      }),
    } }
  })
}

function catalogOf(decision: PreStepDecision) {
  return decision.kind === 'enter' ? decision.messages.find(message => message.source.kind === 'jev-skill-catalog') : undefined
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
  it('uses each legacy Session directory without requiring a working-directory service', async () => {
    const { ctx, agent, root, requests } = await fixture(undefined, true, { service: false })
    const otherCwd = join(root, 'other')
    await mkdir(otherCwd)
    ctx.skills.registerProvider(() => ({ name: 'legacy-directories',
      list: async ({ cwd }) => [{ name: cwd === otherCwd ? 'other-skill' : 'root-skill', description: String(cwd),
        invocation: { modelInvocable: true, userInvocable: true }, source: 'custom', provider: 'legacy-directories', rank: 0, locator: cwd }],
      get: async () => undefined,
    }))
    const otherId = SessionId('legacy-other-' + root)
    const other = { ...agent, id: otherId, session: Session.create(otherId, [], {
      version: SESSION_FORMAT_VERSION, id: otherId, createdAt: 0, cwd: otherCwd, isSeeded: false,
    }) } as Agent
    ctx.agents.enter(other, undefined)
    await step(ctx, agent, [user('Choose root skill')])
    await step(ctx, other, [user('Choose other skill')])
    expect(requests).toHaveLength(2)
    expect(requests[0]?.questions[0]?.prompt).toContain('root-skill')
    expect(requests[0]?.questions[0]?.prompt).toContain(root)
    expect(requests[1]?.questions[0]?.prompt).toContain('other-skill')
    expect(requests[1]?.questions[0]?.prompt).toContain(otherCwd)
    expect((await invoke(ctx, agent, 'skill_catalog', {})).value).toEqual({ skills: [{ name: 'root-skill', description: root }] })
    expect((await invoke(ctx, other, 'skill_catalog', {})).value).toEqual({ skills: [{ name: 'other-skill', description: otherCwd }] })
  })

  it('leaves an unset legacy directory to the provider and reads a later directory service', async () => {
    const { ctx, agent, root, requests } = await fixture(undefined, true, { service: false, sessionCwd: false })
    const directories: Array<string | undefined> = []
    ctx.skills.registerProvider(() => ({ name: 'legacy-default', list: async ({ cwd }) => {
      directories.push(cwd)
      return [{ name: 'skill', description: String(cwd), invocation: { modelInvocable: true, userInvocable: true },
        source: 'custom', provider: 'legacy-default', rank: 0, locator: cwd }]
    }, get: async () => undefined }))
    await step(ctx, agent, [user('Choose default skill')])
    expect(requests).toHaveLength(1)
    await invoke(ctx, agent, 'skill_catalog', {})
    expect(directories).toEqual([undefined])
    await ctx.plugin(WorkingDirectory, { defaultDirectory: root })
    const changed = join(root, 'changed')
    await mkdir(changed)
    const current = await ctx.workingDirectory.set(agent, changed)
    const catalog = await invoke(ctx, agent, 'skill_catalog', {})
    expect(catalog.isError).toBe(false)
    expect(catalog.value).toEqual({ skills: [{ name: 'skill', description: current }] })
    expect(directories.at(-1)).toBe(current)
  })

  it.each([new Error('Directory permission refused'), new DOMException('Directory inspection cancelled', 'AbortError')])(
    'preserves an existing directory service failure without reading the legacy catalog: %s', async failure => {
      const { ctx, agent, requests } = await fixture()
      const snapshot = vi.spyOn(ctx.skills, 'snapshot')
      vi.spyOn(ctx.workingDirectory, 'ensure').mockRejectedValueOnce(failure)
      const result = await invoke(ctx, agent, 'skill_catalog', {})
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result)).toContain(failure.message)
      expect(snapshot).not.toHaveBeenCalled()
      expect(requests).toHaveLength(0)
    },
  )

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
    const candidates: string[][] = []
    ctx.on('tools/execute', async (exec, next) => {
      const result = await next()
      if (exec.name !== 'glob' || result.isError) return result
      const value = result.value as { root: string; paths: string[] }
      const paths = candidates.length === 0 ? value.paths : candidates[0]!.toReversed()
      candidates.push([...paths])
      return { ...result, value: { ...value, paths } }
    })
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
    const second = await invoke(ctx, agent, 'glob', { pattern: '*.ts' })
    expect(second.isError).toBe(false)
    if (second.isError) return
    expect(second.value).toEqual(first.value)
    expect(second.content).toEqual(first.content)
    const rankings = requests.filter(request => request.state !== null && typeof request.state === 'object'
      && 'pattern' in request.state)
    expect(rankings).toHaveLength(2)
    expect(rankings.map(request => request.questions.map(question => question.prompt)))
      .toEqual(candidates.map(paths => paths.map(path => 'Is this path relevant to the task? Path: ' + path)))
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

  it('defaults the probability threshold to 0.5 and rejects nonfinite or out-of-range configuration', () => {
    expect(Config({}).skillMinProbability.get()).toBe(0.5)
    for (const value of [0, 0.5, 1]) expect(Config({ skillMinProbability: value }).skillMinProbability.get()).toBe(value)
    for (const value of [-0.01, 1.01, NaN, Infinity, -Infinity]) {
      expect(() => Config({ skillMinProbability: value })).toThrow()
    }
  })

  it('excludes low relevance probabilities, includes the threshold, and uses confidence only for display', async () => {
    const f = await fixture({ skillLimit: 5, fileCandidates: 40, fileLimit: 12 })
    registerSkills(f.ctx, ['below', 'equal', 'above', 'zero'])
    respond(f, [{ probability: 0.49, confidence: 1 }, { probability: 0.5 },
      { probability: 0.51, confidence: 0.1 }, { probability: 0, confidence: 1 }], ['below', 'equal', 'above', 'zero'])
    const catalog = catalogOf(await step(f.ctx, f.agent, [user('Find a relevant skill')]))
    expect(catalog?.source).toMatchObject({ entries: [{ name: 'above' }, { name: 'equal' }],
      selection: { skillMinProbability: 0.5, skillLimit: 5 } })
    const text = catalog?.content[0]?.type === 'text' ? catalog.content[0].text : ''
    expect(text).toContain('above: above summary (relevance probability 0.51, confidence 0.1)')
    expect(text).toContain('equal: equal summary (relevance probability 0.5)')
    expect(text).not.toContain('below:')
    expect(text).not.toContain('zero:')
    expect(text.match(/confidence/g)).toHaveLength(1)
  })

  it.each([{ threshold: 0, names: ['certain', 'middle', 'zero'] }, { threshold: 1, names: ['certain'] }])(
    'uses the inclusive configured endpoint $threshold', async ({ threshold, names }) => {
      const f = await fixture({ skillLimit: 5, skillMinProbability: threshold, fileCandidates: 40, fileLimit: 12 })
      registerSkills(f.ctx, ['zero', 'middle', 'certain'])
      respond(f, [{ probability: 0 }, { probability: 0.5 }, { probability: 1 }], ['zero', 'middle', 'certain'])
      const catalog = catalogOf(await step(f.ctx, f.agent, [user('Find relevant skills')]))
      expect(catalog?.source.kind === 'jev-skill-catalog' && catalog.source.entries.map(entry => entry.name)).toEqual(names)
    },
  )

  it('publishes an empty catalog for eight low scores and retains recovery and native loading', async () => {
    const f = await fixture({ skillLimit: 5, fileCandidates: 40, fileLimit: 12 })
    const names = Array.from({ length: 8 }, (_, index) => 'unrelated-' + index)
    registerSkills(f.ctx, names)
    respond(f, names.map(() => ({ probability: 0.01 })))
    const recorded: SessionEvent[] = []
    const decision = await step(f.ctx, f.agent, [user('What is six times seven?')], recorded)
    expect(decision.kind).toBe('enter')
    const catalog = catalogOf(decision)
    expect(catalog?.source).toMatchObject({ entries: [], selection: { skillMinProbability: 0.5, skillLimit: 5 } })
    const text = catalog?.content[0]?.type === 'text' ? catalog.content[0].text : ''
    expect(text).toMatchInlineSnapshot(`"<system-reminder>\nNo skill reached the minimum relevance probability in this judgment. Continue the task.\n<available_skills>\n</available_skills>\nCall the skill tool with an exact name before following its instructions. This is a partial catalog; call skill_catalog to see every currently model-invocable skill summary. A user may invoke an eligible skill directly.\n</system-reminder>"`)
    expect(text).not.toContain('unrelated-')
    expect(f.receipts.map(receipt => receipt.id)).toEqual(['skill-catalog-no-relevant'])
    expect(catalogOf(await step(f.ctx, f.agent))).toBeUndefined()
    expect(f.requests).toHaveLength(1)
    const replayId = SessionId('zero-replay-' + f.root)
    const replay = { ...f.agent, id: replayId, session: Session.create(replayId, recorded, {
      version: SESSION_FORMAT_VERSION, id: replayId, createdAt: 0, cwd: f.root, isSeeded: false,
    }) } as Agent
    f.ctx.agents.enter(replay, undefined)
    expect(catalogOf(await step(f.ctx, replay))).toBeUndefined()
    expect(f.requests).toHaveLength(1)
    const full = await invoke(f.ctx, f.agent, 'skill_catalog', {})
    expect(full.value).toEqual({ skills: names.map(name => ({ name, description: name + ' summary' })) })
    const loaded = await invoke(f.ctx, f.agent, 'skill', { name: names[0] })
    expect(loaded.isError).toBe(false)
    expect(JSON.stringify(loaded.content)).toContain(names[0] + ' body')
    expect(f.requests).toHaveLength(1)
    respond(f, names.map((_, index) => ({ probability: index === 0 ? 0.95 : 0.01 })), names)
    const relevant = catalogOf(await step(f.ctx, f.agent, [user('Now use the first skill')]))
    expect(relevant?.source).toMatchObject({ entries: expect.arrayContaining([{ name: names[0], description: names[0] + ' summary' }]) })
    registerSkills(f.ctx, ['new-skill'])
    respond(f, [...names.map(() => ({ probability: 0.01 })), { probability: 0.95 }], [...names, 'new-skill'])
    expect(catalogOf(await step(f.ctx, f.agent))?.source).toMatchObject({ entries: expect.arrayContaining([{ name: 'new-skill', description: 'new-skill summary' }]) })
    expect(f.requests).toHaveLength(3)
  })

  it('keeps one relevant skill without filling the remaining recommendation slots', async () => {
    const f = await fixture({ skillLimit: 5, fileCandidates: 40, fileLimit: 12 })
    registerSkills(f.ctx, ['relevant', ...Array.from({ length: 7 }, (_, index) => 'irrelevant-' + index)])
    respond(f, [{ probability: 0.95 }, ...Array.from({ length: 7 }, () => ({ probability: 0.01 }))],
      ['relevant', ...Array.from({ length: 7 }, (_, index) => 'irrelevant-' + index)])
    expect(catalogOf(await step(f.ctx, f.agent, [user('Use the relevant skill')]))?.source)
      .toMatchObject({ entries: [{ name: 'relevant' }] })
  })

  it('sorts eligible candidates stably, caps before deduplication, and does not fill visible slots', async () => {
    const f = await fixture({ skillLimit: 5, fileCandidates: 40, fileLimit: 12 })
    const names = ['a-first-tie', 'b-best', 'c-second-tie', 'd-third', 'e-third-tie', 'f-second', 'g-last-tie']
    registerSkills(f.ctx, names)
    const scores = [0.7, 0.95, 0.7, 0.8, 0.7, 0.9, 0.7].map(probability => ({ probability }))
    respond(f, scores)
    const first = catalogOf(await step(f.ctx, f.agent, [user('First request')]))
    expect(first?.source.kind === 'jev-skill-catalog' && first.source.entries.map(entry => entry.name))
      .toEqual(['b-best', 'f-second', 'd-third', 'a-first-tie', 'c-second-tie'])
    respond(f, scores)
    expect(catalogOf(await step(f.ctx, f.agent, [user('Same skills')]))).toBeUndefined()
    expect(f.receipts.at(-1)?.id).toBe('skill-catalog-no-new')
    respond(f, names.map(() => ({ probability: 0.01 })))
    expect(catalogOf(await step(f.ctx, f.agent, [user('Unrelated request')]))?.source).toMatchObject({ entries: [] })
    expect(f.receipts.at(-1)?.id).toBe('skill-catalog-no-relevant')
    expect(f.agent.session.deriveMessages().some(message => message.id === first?.id)).toBe(true)
  })

  it('refreshes threshold and count on retry and keeps the successful attempt settings frozen', async () => {
    const f = await fixture({ skillLimit: 1, skillMinProbability: 0.9, fileCandidates: 40, fileLimit: 12 })
    registerSkills(f.ctx, ['alpha', 'beta', 'gamma'])
    f.judge.mockImplementationOnce(async options => {
      f.requests.push(await options.refresh(new AbortController().signal))
      updateVolatile(f.settings.skillMinProbability, createVolatile(0.6))
      updateVolatile(f.settings.skillLimit, createVolatile(2))
      const request = await options.refresh(new AbortController().signal)
      f.requests.push(request)
      updateVolatile(f.settings.skillMinProbability, createVolatile(1))
      updateVolatile(f.settings.skillLimit, createVolatile(1))
      return { kind: 'ok', operationId: 'retried', attemptId: 'attempt-2', response: {
        answers: request.questions.map(question => ({ id: question.id, kind: 'noul', probability: 0.7 })),
      } }
    })
    expect(catalogOf(await step(f.ctx, f.agent, [user('Find skills')]))?.source).toMatchObject({
      entries: [{ name: 'alpha' }, { name: 'beta' }], selection: { skillMinProbability: 0.6, skillLimit: 2 },
    })
    expect(f.requests).toHaveLength(2)
  })

  it.each(['cancelled', 'not-adopted'] as const)('does not publish zero success after %s judgment', async kind => {
    const f = await fixture()
    registerSkills(f.ctx, ['alpha'])
    f.judge.mockResolvedValueOnce({ kind, operationId: 'unsuccessful' })
    await expect(step(f.ctx, f.agent, [user('Choose a skill')])).rejects.toThrow('cancelled or could not be adopted')
    expect(f.receipts).toEqual([])
    expect(f.agent.session.deriveMessages()).toEqual([])
  })

  it('rejects incomplete judgment and preserves thrown failures without recording zero success', async () => {
    const f = await fixture()
    registerSkills(f.ctx, ['alpha'])
    f.judge.mockImplementationOnce(async options => {
      await options.refresh(new AbortController().signal)
      expect(await options.interpret?.({ answers: [] })).toEqual({ usable: false, reason: 'Jev returned an incomplete skill ranking' })
      throw new Error('Manual Retry/Cancel remains pending')
    })
    await expect(step(f.ctx, f.agent, [user('Choose a skill')])).rejects.toThrow('Manual Retry/Cancel remains pending')
    expect(f.receipts).toEqual([])
    f.judge.mockRejectedValueOnce(new Error('Transport failed'))
    await expect(step(f.ctx, f.agent, [user('Retry skill')])).rejects.toThrow('Transport failed')
    expect(f.receipts).toEqual([])
    expect(f.agent.session.deriveMessages()).toEqual([])
  })

  it('leaves an initially empty skill directory to the Host without a zero-result receipt', async () => {
    const f = await fixture()
    await step(f.ctx, f.agent, [user('Proceed without skills')])
    expect(f.requests).toEqual([])
    expect(f.receipts).toEqual([])
  })

  it('does not turn a directory emptied during retry into successful zero selection', async () => {
    const f = await fixture()
    const unregister = f.ctx.skills.register({ name: 'alpha', description: 'Alpha', source: 'runtime', content: 'Alpha body' })
    f.judge.mockImplementationOnce(async options => {
      await options.refresh(new AbortController().signal)
      unregister()
      await options.refresh(new AbortController().signal)
      throw new Error('An empty retry should not reach a response')
    })
    await expect(step(f.ctx, f.agent, [user('Find a skill')])).rejects.toThrow('No skills remain available')
    expect(f.receipts).toEqual([])
    expect(f.agent.session.deriveMessages()).toEqual([])
  })

  it.each([0.01, 0.95])('calls the shipped runtime selection entry with probability %s', async probability => {
    const runtime = await import('../../../runtime/selection.js')
    expect(runtime.Config({}).skillMinProbability.get()).toBe(0.5)
    const f = await fixture(undefined, true, {}, runtime)
    registerSkills(f.ctx, ['alpha'])
    respond(f, [{ probability }])
    const catalog = catalogOf(await step(f.ctx, f.agent, [user('Choose a skill')]))
    expect(catalog?.source).toMatchObject({ entries: probability < 0.5 ? [] : [{ name: 'alpha' }],
      selection: { skillMinProbability: 0.5, skillLimit: 1 } })
    expect(f.receipts[0]?.id).toBe(probability < 0.5 ? 'skill-catalog-no-relevant' : 'skill-catalog-published')
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
          return { id: question.id, kind: 'noul', probability: position < 0 ? 0 : (9 - position) / 10 }
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

  it('rebuilds visible-name deduplication for legacy replayed Sessions and isolates a fresh Session', async () => {
    const { ctx, agent, root, requests } = await fixture()
    ctx.skills.register({ name: 'alpha', description: 'Alpha', source: 'runtime', content: 'Body A' })
    const recorded: SessionEvent[] = []
    await step(ctx, agent, [user('alpha')], recorded)
    const legacy = recorded.map((event): SessionEvent => {
      if (event.type !== 'user/message' || event.data.source.kind !== 'jev-skill-catalog') return event
      const { kind, form, entries, fullFingerprint } = event.data.source
      return { ...event, data: { ...event.data, source: { kind, form, entries, fullFingerprint } } }
    })
    const replayId = SessionId('replay-' + root)
    const replaySession = Session.create(replayId, legacy, {
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
