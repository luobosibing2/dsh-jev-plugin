import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createVolatile, updateVolatile } from '@deepseek-ai/cosmokit'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import { createAssistantMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import { apply, Config as OutputConfig, type Config } from '../src/output-admission.ts'
import type { JevJudgeOptions, JevJudgeOnceResult } from '../src/index.ts'
import type { JevActionReceipt } from '../src/types.ts'

const progress = Array.from({ length: 48 }, (_, index) => `progress ${index}: ${'.'.repeat(140)}\n`).join('')
const ordinary = `Start\n${progress}Evidence: do not discard\nDone\n`
const testProgress = `Test Files 1 passed\n${Array.from({ length: 400 }, (_, index) => `progress ${index}%\n`).join('')}Tests 1 passed\n`
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })

interface Fixture {
  ctx: Context
  agent: Agent
  enabled: Record<string, boolean>
  calls: JevJudgeOptions[]
  records: string[]
  receipts: JevActionReceipt[]
  saves: string[]
  notes: { code: string; message: string }[]
  limits: Config
  run(signal?: AbortSignal, jobKind?: string): Promise<string>
}

async function fixture(log = ordinary, answer?: (options: JevJudgeOptions) => Promise<JevJudgeOnceResult>,
  userText = 'Build the fixture and preserve errors.', waitMs = 4000): Promise<Fixture> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  ctx.provide('settings', { configure: () => () => {} } as never)
  const saves: string[] = []
  ctx.provide('spillStore', { saveText: async ({ content }: { content: string }) => {
    saves.push(content)
    return { locator: 'spill://original', retrievalHint: 'read original', bytes: content.length }
  } } as never)
  const enabled = { 'output-admission': true, 'test-log-admission': true }
  const calls: JevJudgeOptions[] = []
  const records: string[] = []
  const receipts: JevActionReceipt[] = []
  const notes: { code: string; message: string }[] = []
  ctx.provide('jev', {
    registerFeature: () => () => {}, isFeatureEnabled: (id: string) => enabled[id as keyof typeof enabled] ?? false,
    judgeOnce: async (options: JevJudgeOptions) => {
      calls.push(options)
      if (answer) return answer(options)
      const request = await options.refresh(options.signal ?? new AbortController().signal)
      return { kind: 'ok', operationId: `judge-${calls.length}`, attemptId: 'attempt', response: {
        answers: request.questions.map(question => ({ id: question.id, kind: 'choice' as const, optionId: 'omit', confidence: 0.95 })),
      } }
    },
    recordRuleObservation: async (id: string) => { records.push(id); return { id: `rule-${records.length}` } },
    writeReceipt: async (_id: string, receipt: JevActionReceipt) => { receipts.push(receipt) },
    noteFailure: async (_id: string, code: string, message: string) => { notes.push({ code, message }) },
  } as never)
  const id = SessionId('output-hook')
  const session = Session.create(id, undefined, { version: SESSION_FORMAT_VERSION, id, createdAt: 0, cwd: process.cwd(), isSeeded: false })
  const agent = { ctx, id, options: {}, status: 'running', session, inbox: { nextStep: [], nextTurn: [] },
    send: () => {}, followup: () => {}, steer: () => {}, inject: () => {}, cancel: () => {},
    runMaintenance: (task: (signal: AbortSignal) => Promise<unknown>) => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  } as Agent
  ctx.agents.enter(agent, undefined)
  if (userText) agent.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: userText }] }), { surfaceOp: 'append' })
  ctx.tools.register(defineTool({ name: 'bash', description: 'Fixture output', parameters: {
    command: { type: 'string', required: true },
  },
    output: { schema: { type: 'object', additionalProperties: false, properties: {
      kind: { type: 'string', required: true }, exitCode: { type: 'integer', required: true },
      signal: { type: 'null', required: true }, text: { type: 'string', required: true },
    } }, render: (_args, value) => [{ type: 'text', text: value.text }] },
    execute: () => ({ kind: 'foreground', exitCode: 0, signal: null, text: log }),
  }))
  ctx.tools.register(defineTool({ name: 'job_output', description: 'Fixture job', parameters: {
    kind: { type: 'string', required: true },
  }, output: { schema: { type: 'object', additionalProperties: false, properties: {
    text: { type: 'string', required: true }, job: { type: 'object', required: true, additionalProperties: false,
      properties: { kind: { type: 'string', required: true }, status: { type: 'string', required: true },
        label: { type: 'string', required: true } } },
  } }, render: (_args, value) => [{ type: 'text', text: value.text }] },
  execute: args => ({ text: log, job: { kind: args.kind, status: 'completed', label: 'fixture build' } }),
  }))
  const config = Object.fromEntries(Object.entries({ generalMinChars: 6000, testMinChars: 4000,
    generalBlockChars: 1200, maxGeneralBlocks: 48, maxTestCandidates: 24, maxRequestChars: 48000,
    maxTaskChars: 12000, waitMs, omitProbability: 0.8, minSavedChars: 300, minSavedRatio: 0.1,
    slowTestMs: 300, duplicateMinLines: 6, duplicateMinChars: 200,
  }).map(([key, value]) => [key, createVolatile(value)])) as Config
  apply(ctx, config)
  cleanup.push(async () => { await ctx.fiber.dispose() })
  let sequence = 0
  const run = async (signal = new AbortController().signal, jobKind?: string) => {
    const result = await ctx.agents.withInitiator(agent, () => ctx.tools.execute({
      name: jobKind === undefined ? 'bash' : 'job_output',
      arguments: jobKind === undefined ? { command: 'fixture build' } : { kind: jobKind },
      agent, signal, callId: ToolCallId(`fixture-${++sequence}`),
    }))
    return result.content[0]?.type === 'text' ? result.content[0].text : ''
  }
  return { ctx, agent, enabled, calls, records, receipts, saves, notes, limits: config, run }
}

describe('output admission Hook failures and rule records', () => {
  it('judges command candidates beyond 48 total groups while retaining protected evidence', async () => {
    const retained = Array.from({ length: 24 }, (_, index) => `Artifact ${index}\n`)
    const log = `progress 0%\n${retained.map(line => `${line}${'progress 10%\n'.repeat(50)}`).join('')}Artifact final\nprogress 100%\n`
    const item = await fixture(log)
    const result = await item.run()
    expect(item.calls).toHaveLength(1)
    const request = await item.calls[0]!.refresh(new AbortController().signal)
    const state = request.state as { candidates: { text: string }[];
      retainedEvidence: { chunks: { text: string }[] } }
    expect(state.candidates).toHaveLength(24)
    expect(state.candidates.every(candidate => candidate.text === 'progress 10%\n'.repeat(50))).toBe(true)
    const evidence = state.retainedEvidence.chunks.map(chunk => chunk.text).join('')
    for (const line of [...retained, 'progress 0%\n', 'Artifact final\nprogress 100%\n']) {
      expect(evidence).toContain(line)
      expect(result).toContain(line)
    }
    expect(result).toContain('[Jev omitted')
    expect(item.saves).toEqual([log])
  })

  it('adopts an omit answer at the default 0.8 threshold and retains one below it', async () => {
    expect(OutputConfig({}).omitProbability.get()).toBe(0.8)
    for (const [probability, adopted] of [[0.8, true], [0.799, false]] as const) {
      const item = await fixture(ordinary, async options => {
        const request = await options.refresh(options.signal ?? new AbortController().signal)
        return { kind: 'ok', operationId: `probability-${probability}`, attemptId: 'one', response: {
          answers: request.questions.map(question => ({ id: question.id, kind: 'choice', optionId: 'omit',
            probabilities: { omit: probability, keep: 1 - probability, unknown: 0 } })),
        } }
      })
      const result = await item.run()
      expect(result.includes('[Jev original log:')).toBe(adopted)
      expect(item.saves.length > 0).toBe(adopted)
    }
  })

  it('keeps original when Jev fails, returns incomplete answers, or lacks confidence', async () => {
    const failed = await fixture(ordinary, async () => ({ kind: 'failed', failure: { code: 'NETWORK', message: 'unavailable' } }))
    expect(await failed.run()).toBe(ordinary)
    const incomplete = await fixture(ordinary, async () => ({ kind: 'ok', operationId: 'invalid', attemptId: 'one', response: { answers: [] } }))
    expect(await incomplete.run()).toBe(ordinary)
    const noConfidence = await fixture(ordinary, async options => {
      const request = await options.refresh(options.signal ?? new AbortController().signal)
      return { kind: 'ok', operationId: 'unknown', attemptId: 'one', response: { answers: request.questions.map(question => ({
        id: question.id, kind: 'choice', optionId: 'omit',
      })) } }
    })
    expect(await noConfidence.run()).toBe(ordinary)
    expect(failed.saves).toEqual([])
  })

  it('records rules-only progress with zero Jev calls and a final-result receipt', async () => {
    const item = await fixture(testProgress, undefined, '')
    const result = await item.run()
    expect(result).toContain('unneeded progress with no known task target')
    expect(result).not.toContain('undefined-NaN')
    expect(item.calls).toEqual([])
    expect(item.records).toEqual(['test-log-admission'])
    await vi.waitFor(() => { expect(item.receipts).toHaveLength(1) })
    expect(item.receipts[0]?.reason).toContain('"finalChars"')
  })

  it('uses an already-issued answer after the feature is disabled', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const item = await fixture(ordinary, async options => {
      const request = await options.refresh(options.signal ?? new AbortController().signal)
      await gate
      return { kind: 'ok', operationId: 'issued', attemptId: 'one', response: { answers: request.questions.map(question => ({
        id: question.id, kind: 'choice', optionId: 'omit', confidence: 0.95,
      })) } }
    })
    const result = item.run()
    await vi.waitFor(() => { expect(item.calls).toHaveLength(1) })
    item.enabled['output-admission'] = false
    release()
    expect(await result).toContain('[Jev original log:')
  })

  it('marks a wait-limit fallback on its cancelled operation', async () => {
    const item = await fixture(ordinary, async options => {
      await new Promise<void>(resolve => { options.signal!.addEventListener('abort', () => resolve(), { once: true }) })
      return { kind: 'cancelled', operationId: 'timed-out' }
    }, 'Build the fixture.', 15)
    expect(await item.run()).toBe(ordinary)
    expect(item.notes).toEqual([{ code: 'ADMISSION_TIMEOUT',
      message: 'Log admission wait limit expired; the original tool result continued through the Host.' }])
  })

  it('retains an effective full-log request across several later user inputs', async () => {
    const item = await fixture(ordinary, undefined, 'Keep the complete log verbatim.')
    for (const followup of ['Continue.', 'Continue.', 'Also check A.', 'Continue.', 'Continue.']) {
      item.agent.session.append('user/message', createUserMessage({ source: { kind: 'user' },
        content: [{ type: 'text', text: followup }] }), { surfaceOp: 'append' })
    }
    expect(await item.run()).toBe(ordinary)
    expect(item.calls).toEqual([])
  })

  it('honors a visible assistant intention to return the full output', async () => {
    const item = await fixture(ordinary)
    item.agent.session.append('assistant/message', { turn: 1, step: 1,
      message: createAssistantMessage({ source: { provider: 'fixture', model: 'script' },
        content: [{ type: 'text', text: 'I will show the complete command output.' }] }), stream: [],
    }, { surfaceOp: 'append' })
    expect(await item.run()).toBe(ordinary)
    expect(item.calls).toEqual([])
  })

  it('abandons a pending reduction when the plugin lifetime ends', async () => {
    let started!: () => void
    const entered = new Promise<void>(resolve => { started = resolve })
    const item = await fixture(ordinary, async options => {
      started()
      await new Promise<void>(resolve => { options.signal!.addEventListener('abort', () => resolve(), { once: true }) })
      return { kind: 'cancelled', operationId: 'unloaded' }
    })
    const result = item.run()
    await entered
    await item.ctx.fiber.dispose()
    expect(await result).toBe(ordinary)
    expect(item.saves).toEqual([])
  })

  it('keeps a short explicitly named test while omitting other passing groups', async () => {
    const log = `Test Files 1 passed\n${Array.from({ length: 100 }, (_, index) =>
      `✓ suite > ${index === 40 ? 'foo' : `case-${index}`} 20ms ${'.'.repeat(60)}\n`).join('')}Tests 100 passed\n`
    const item = await fixture(log, undefined, '只看 `foo` 的时间，其他普通通过项可去噪。')
    const result = await item.run()
    expect(result).toContain('✓ suite > foo 20ms')
    expect(result).toContain('[Jev omitted')
    expect(item.calls).toHaveLength(1)
  })

  it('does not ask Jev to remove pure passing details without retained test evidence', async () => {
    const log = Array.from({ length: 90 }, (_, index) =>
      `PASS case-${index}.test.ts ${'.'.repeat(55)}\n`).join('')
    const item = await fixture(log, undefined, 'Give the overall test result.')
    expect(await item.run()).toBe(log)
    expect(item.calls).toEqual([])
    expect(item.saves).toEqual([])
  })

  it('sends byte-mapped retained results and an exact failure reference in the actual judgment request', async () => {
    const detail = Array.from({ length: 8 }, (_, index) =>
      `    at fixture.ts:${index} expected exact error detail to remain in the tool result\n`).join('')
    const passing = Array.from({ length: 70 }, (_, index) =>
      `✓ ordinary case-${index} 12ms ${'.'.repeat(60)}\n`).join('')
    const log = `Test Files 2 failed\n${passing}FAIL auth.test.ts\n${detail}FAIL payment.test.ts\n${detail}Tests 2 failed | 70 passed\n[exit code: 1]`
    const item = await fixture(log, undefined, 'Fix the failing tests; only the failure evidence and summary are needed.')
    const result = await item.run()
    const request = await item.calls[0]!.refresh(new AbortController().signal)
    expect(String(request.questions[0]?.prompt)).toContain('exactDuplicateReferences')
    expect(String(request.questions[0]?.prompt)).toContain('no other judged candidate is guaranteed')
    const state = request.state as { retainedEvidence: {
      source: string; chunks: { firstLine: number; lastLine: number; text: string; reason: string }[];
      exactDuplicateReferences: { duplicateFirstLine: number; duplicateLastLine: number;
        originalFirstLine: number; originalLastLine: number; exactTextEqual: boolean }[];
    }; candidates: { firstLine: number; lastLine: number; text: string }[] }
    const lines = log.match(/[^\n]*\n|[^\n]+$/g) ?? []
    for (const chunk of state.retainedEvidence.chunks) {
      expect(chunk.text).toBe(lines.slice(chunk.firstLine - 1, chunk.lastLine).join(''))
      expect(chunk.reason.length).toBeGreaterThan(0)
      expect(state.candidates.every(candidate => candidate.lastLine < chunk.firstLine || candidate.firstLine > chunk.lastLine)).toBe(true)
    }
    expect(state.retainedEvidence.source).toBe('tool-result-logs')
    expect(state.retainedEvidence.chunks.some(chunk => chunk.text.includes('FAIL auth.test.ts') && chunk.text.includes(detail))).toBe(true)
    expect(state.retainedEvidence.chunks.some(chunk => chunk.text.includes('Tests 2 failed | 70 passed'))).toBe(true)
    expect(state.retainedEvidence.exactDuplicateReferences).toHaveLength(1)
    const reference = state.retainedEvidence.exactDuplicateReferences[0]!
    expect(reference.exactTextEqual).toBe(true)
    expect(lines.slice(reference.duplicateFirstLine - 1, reference.duplicateLastLine).join(''))
      .toBe(lines.slice(reference.originalFirstLine - 1, reference.originalLastLine).join(''))
    expect(result).toContain(`exact duplicate of original lines ${reference.originalFirstLine}-${reference.originalLastLine}`)
  })

  it('keeps unsent candidates and skips semantic judgment when complete retained evidence cannot fit', async () => {
    const shrunk = await fixture()
    updateVolatile(shrunk.limits.maxRequestChars, createVolatile(4000))
    const output = await shrunk.run()
    expect(shrunk.calls).toHaveLength(1)
    const request = await shrunk.calls[0]!.refresh(new AbortController().signal)
    expect(String(request.questions[0]?.prompt)).toContain('ordinary pass')
    const state = request.state as { retainedEvidence: { unshownRetainedCandidates: { firstLine: number; lastLine: number }[];
      unshownRetainedCandidateCount: number } }
    expect(state.retainedEvidence.unshownRetainedCandidates.length).toBeGreaterThan(0)
    expect(state.retainedEvidence.unshownRetainedCandidateCount).toBe(state.retainedEvidence.unshownRetainedCandidates.length)
    expect(Array.from(JSON.stringify(request)).length).toBeLessThanOrEqual(4000)
    const originalLines = ordinary.match(/[^\n]*\n|[^\n]+$/g) ?? []
    for (const range of state.retainedEvidence.unshownRetainedCandidates) {
      expect(output).toContain(originalLines.slice(range.firstLine - 1, range.lastLine).join(''))
    }

    const insufficient = await fixture()
    updateVolatile(insufficient.limits.maxRequestChars, createVolatile(1000))
    expect(await insufficient.run()).toBe(ordinary)
    expect(insufficient.calls).toEqual([])
  })

  it('skips a semantic request when an unabridged protected result alone exceeds the budget', async () => {
    const longResult = `Start\n${progress}Artifact ${'X'.repeat(49_000)}\nDone\n`
    const item = await fixture(longResult)
    expect(await item.run()).toBe(longResult)
    expect(item.calls).toEqual([])
  })

  it('routes all switch combinations through at most one branch', async () => {
    const log = `Test Files 1 passed\n${Array.from({ length: 90 }, (_, index) =>
      `✓ suite > case-${index} 20ms ${'.'.repeat(75)}\n`).join('')}Tests 90 passed\n`
    const cases = [
      { general: false, test: false, feature: undefined },
      { general: true, test: false, feature: 'output-admission' },
      { general: false, test: true, feature: 'test-log-admission' },
      { general: true, test: true, feature: 'test-log-admission' },
    ] as const
    for (const entry of cases) {
      const item = await fixture(log, undefined, 'Run the fixture tests.')
      item.enabled['output-admission'] = entry.general
      item.enabled['test-log-admission'] = entry.test
      const result = await item.run()
      expect(item.calls.map(call => call.featureId)).toEqual(entry.feature === undefined ? [] : [entry.feature])
      expect(result.includes('[Jev original log:')).toBe(entry.feature !== undefined)
    }
  })

  it('admits declared shell jobs and leaves subagent or unknown jobs untouched', async () => {
    const shell = await fixture()
    expect(await shell.run(undefined, 'bash')).toContain('[Jev original log:')
    expect(shell.calls).toHaveLength(1)
    const agent = await fixture()
    expect(await agent.run(undefined, 'subagent')).toBe(ordinary)
    expect(agent.calls).toEqual([])
    const other = await fixture()
    expect(await other.run(undefined, 'custom')).toBe(ordinary)
    expect(other.calls).toEqual([])
  })
})
