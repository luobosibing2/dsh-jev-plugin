import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { createVolatile } from '@deepseek-ai/cosmokit'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { PtcRuntime, type PtcRunRequest, type PtcRunResult, type PtcRunSpec } from '@deepseek-ai/dsh-ptc-runtime'
import SessionStore, { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import {
  applyGlobTool, GLOB_MAX_RESULTS, RAW_OUTPUT_MAX_BYTES, SEARCH_GRACE_MS,
  SEARCH_META_MAX_BYTES, SEARCH_STDERR_MAX_BYTES, SEARCH_TIMEOUT_MS,
} from '@deepseek-ai/dsh-tool-fs-search'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { apply } from '../src/selection.ts'
import type { JevJudgeOptions, JevJudgeResult } from '../src/index.ts'
import type { JevRequest } from '../src/types.ts'

class BindingRuntime extends PtcRuntime {
  readonly language = 'typescript'
  readonly isolation = 'test'
  value?: unknown

  resolve(request: PtcRunRequest): PtcRunSpec {
    return { ...request, cwd: request.cwd ?? process.cwd(), timeoutMs: request.timeoutMs ?? 120_000 }
  }

  async run(request: PtcRunRequest): Promise<PtcRunResult> {
    this.value = await request.bindings[0]!.functions.glob!({ pattern: '*.ts' })
    return { logs: [], value: 'glob called' }
  }
}

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

describe('glob selection through the published DSH PTC bridge', () => {
  it('returns ranked paths to the program and forwards recorded scores to the model context', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jev-selection-ptc-'))
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    const ctx = new Context()
    cleanups.push(() => ctx.fiber.dispose())
    await ctx.plugin(LocalFileSystem, { cwd: root })
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(WorkingDirectory)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime, { mode: 'ptc' })
    await ctx.plugin(BindingRuntime)
    const runtime = ctx.ptcRuntime as BindingRuntime

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
    ctx.provide('settings', { configure: () => () => {} } as never)
    const requests: JevRequest[] = []
    const judge = vi.fn(async (options: JevJudgeOptions): Promise<JevJudgeResult> => {
      const request = await options.refresh(options.signal ?? new AbortController().signal)
      requests.push(request)
      return {
        kind: 'ok', operationId: 'ptc-selection', attemptId: 'first',
        response: { answers: request.questions.map((question, index) => ({
          id: question.id, kind: 'noul', probability: index === 0 ? 0.1 : 0.9,
        })) },
      }
    })
    ctx.provide('jev', {
      registerFeature: () => () => {},
      listFeatures: async () => [
        { id: 'skill-selection', enabled: false },
        { id: 'file-ranking', enabled: true },
      ],
      judge,
      writeReceipt: async () => {},
    } as never)
    applyGlobTool(ctx, {
      sampleOverCapGlobResults: false,
      maxResults: GLOB_MAX_RESULTS,
      maxMetaBytes: SEARCH_META_MAX_BYTES,
      rawOutputMaxBytes: RAW_OUTPUT_MAX_BYTES,
      graceMs: SEARCH_GRACE_MS,
      stderrMaxBytes: SEARCH_STDERR_MAX_BYTES,
      timeoutMs: SEARCH_TIMEOUT_MS,
    })
    apply(ctx, {
      skillLimit: createVolatile(5), fileCandidates: createVolatile(40), fileLimit: createVolatile(12),
    })

    const events: SessionEvent[] = []
    ctx.on('session/event', (_session, event) => { events.push(event) })
    const session = ctx.sessions.create(SessionId('jev-selection-ptc'), { meta: { cwd: root } })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Find the relevant TypeScript file' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('turn/start', { turn: 1 })
    const agent = { ctx, id: 'jev-selection-ptc', session } as Agent
    ctx.agents.enter(agent, undefined)

    const result = await ctx.agents.withInitiator(agent, () => ctx.tools.execute({
      name: 'run_code',
      arguments: { code: 'return await tools.glob({ pattern: "*.ts" })', description: 'Find files' },
      agent, signal: new AbortController().signal, callId: ToolCallId('jev-selection-ptc-call'),
    }))

    expect(result.isError).toBe(false)
    expect(requests).toHaveLength(1)
    expect(runtime.value).toEqual({ root: '.', paths: ['a.ts', 'b.ts'] })
    expect(result.additionalContexts).toHaveLength(1)
    const scoreContext = result.additionalContexts![0]!
    expect(scoreContext.source).toMatchObject({ kind: 'jev-file-ranking' })
    const scores = scoreContext.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
    expect(scores).toContain('a.ts')
    expect(scores).toContain('0.9')
    expect(scores).toContain('b.ts')
    expect(scores).toContain('0.1')

    await vi.waitFor(() => expect(events.some(event => event.type === 'tool/ptc-dispatch')).toBe(true))
    const dispatch = events.find(event => event.type === 'tool/ptc-dispatch')
    expect(dispatch).toMatchObject({ type: 'tool/ptc-dispatch', data: { name: 'glob', isError: false } })
    if (dispatch?.type !== 'tool/ptc-dispatch') throw new Error('glob sub-dispatch was not recorded')
    expect(dispatch.data.content.some(block => block.type === 'text' && block.text.includes('0.9'))).toBe(true)
    expect(session.deriveMessages().some(message => JSON.stringify(message).includes('0.9'))).toBe(false)

    // Reproduce the loop's user/message commitment for the forwarded outer context.
    session.append('user/message', scoreContext, { surfaceOp: 'append' })
    await vi.waitFor(() => expect(events.some(event => event.type === 'user/message'
      && event.data.source.kind === 'jev-file-ranking')).toBe(true))
    expect(session.deriveMessages().at(-1)).toEqual(scoreContext)
    await vi.waitFor(() => expect(events).toHaveLength(session.seq))
    const replay = Session.create(session.id, events, session.header)
    expect(replay.deriveMessages().at(-1)).toEqual(scoreContext)
  })
})
