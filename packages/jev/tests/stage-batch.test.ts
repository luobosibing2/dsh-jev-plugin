import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { StageNavigationManager, type Config } from '../src/stage-navigation.ts'
import type { StageStore } from '../src/stage-store.ts'
import type { StageAnalysisRecord } from '../src/stage-types.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

const events = [
  { seq: 0, type: 'turn/start', data: { turn: 1 }, time: 0 },
  { seq: 1, type: 'step/start', data: { turn: 1, step: 1 }, time: 1 },
  { seq: 2, type: 'user/message', data: { id: 'user-1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Please implement' }] }, time: 2 },
  { seq: 3, type: 'assistant/message', data: { turn: 1, step: 1, message: { id: 'assistant-1', role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text: 'Done' }] }, stream: [] }, time: 3 },
  { seq: 4, type: 'step/end', data: { turn: 1, step: 1 }, time: 4 },
  { seq: 5, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } }, time: 5 },
] as SessionEvent[]

function fixture(options: {
  events?: SessionEvent[]
  observe?: () => Promise<object>
  judge?: () => Promise<object>
  getRecord?: () => Promise<object | null>
  save?: (record: StageAnalysisRecord) => Promise<void>
  resolveCredential?: () => Promise<object | undefined>
} = {}) {
  let enabled = true
  const saved = new Map<string, StageAnalysisRecord>()
  const history = options.events ?? events
  const observation = { header: { id: 'session-1', cwd: '/tmp/project' }, cursor: history.at(-1)?.seq ?? -1, events: history,
    [Symbol.dispose]() {} }
  const observeSession = vi.fn(options.observe ?? (async () => observation))
  const page = vi.fn(async () => ({ records: [], hasMore: false }))
  const judgeOnce = vi.fn(options.judge ?? (async () => ({ kind: 'failed', failure: { code: 'SERVER', message: 'Jev server failed' } })))
  const getRecord = vi.fn(options.getRecord ?? (async () => null))
  const connection = { connectionId: 'jev' as const, baseUrl: 'http://127.0.0.1/test', model: 'jev-fixture', credentialRef: 'JEV_KEY', timeoutMs: 1000 }
  const context = { sessionQuery: { observeSession }, sessionController: { page },
    credentials: { resolve: options.resolveCredential ?? (async () => undefined) },
    jev: { isFeatureEnabled: () => enabled, stageConnectionIdentity: () => ({ baseUrl: 'http://127.0.0.1/test', model: 'jev-fixture', credentialRef: 'JEV_KEY', timeoutMs: 1000 }),
      stageConnections: () => [connection], judgmentConnectionIdentity: () => connection,
      judgeOnce, getRecord },
  } as never as Context
  const store = { forSession: (sessionId: string) => [...saved.values()].filter(record => record.sessionId === sessionId),
    save: async (record: StageAnalysisRecord) => {
      if (options.save !== undefined) await options.save(record)
      saved.set(record.id, record)
    }, close: async () => {} } as StageStore
  const value = (number: number) => ({ get: () => number })
  const config = { previousSteps: value(2), previousChars: value(700), maxRequestChars: value(48_000), concurrency: value(1) } as Config
  const manager = new StageNavigationManager(context, config, store)
  return { manager, saved, observeSession, page, judgeOnce, getRecord, disable: () => { enabled = false } }
}

const request = { sessionId: 'session-1', scope: { kind: 'turn', turn: 1 } as const, mode: 'missing' as const }

describe('stage batch ownership and cancellation', () => {
  it('does not dispatch when the credential cannot be checked for redaction', async () => {
    const f = fixture({ resolveCredential: async () => { throw new Error('credential store unavailable') } })
    await expect(f.manager.start(request)).rejects.toMatchObject({ code: 'CREDENTIAL_UNAVAILABLE' })
    expect(f.judgeOnce).not.toHaveBeenCalled()
    await f.manager.stop()
  })

  it('does not dispatch when a short credential cannot be selectively redacted', async () => {
    const f = fixture({ resolveCredential: async () => ({ value: 'abc' }) })
    await expect(f.manager.start(request)).rejects.toMatchObject({ code: 'CREDENTIAL_UNSAFE' })
    expect(f.judgeOnce).not.toHaveBeenCalled()
    await f.manager.stop()
  })

  it('shares an in-progress preparation, so simultaneous clicks dispatch one target once', async () => {
    const gate = deferred<object>()
    const entered = deferred<void>()
    const f = fixture({ observe: () => gate.promise, judge: async () => {
      entered.resolve()
      return { kind: 'failed', failure: { code: 'SERVER', message: 'Jev server failed' } }
    } })
    const first = f.manager.start(request)
    const second = f.manager.start(request)
    expect(second).toBe(first)
    gate.resolve({ header: { id: 'session-1', cwd: '/tmp/project' }, cursor: 5, events, [Symbol.dispose]() {} })
    const batch = await first
    await entered.promise
    await f.manager.cancel(batch.id)
    expect(f.observeSession).toHaveBeenCalledTimes(1)
    expect(f.page).toHaveBeenCalledTimes(1)
    expect(f.judgeOnce).toHaveBeenCalledTimes(1)
    await f.manager.stop()
  })

  it('disablement during history preparation prevents model dispatch', async () => {
    const gate = deferred<object>()
    const f = fixture({ observe: () => gate.promise })
    const started = f.manager.start(request)
    f.disable()
    f.manager.cancelRunning()
    gate.resolve({ header: { id: 'session-1', cwd: '/tmp/project' }, cursor: 5, events, [Symbol.dispose]() {} })
    await expect(started).rejects.toThrow()
    expect(f.judgeOnce).not.toHaveBeenCalled()
    await f.manager.stop()
  })

  it('a late ledger read cannot adopt an answer after disablement', async () => {
    const held = deferred<object | null>()
    const entered = deferred<void>()
    const f = fixture({
      judge: async () => ({ kind: 'ok', operationId: 'op-1', attemptId: 'attempt-1', response: {
        answers: [{ id: 'stage', kind: 'choice', optionId: 'implementation', confidence: 0.45 }],
      } }),
      getRecord: async () => { entered.resolve(); return held.promise },
    })
    const batch = await f.manager.start(request)
    await entered.promise
    f.disable()
    f.manager.cancelRunning()
    held.resolve({ attemptRecords: [{ id: 'attempt-1', connection: { model: 'jev-fixture' }, rawResponse: { model: 'jev-1.13.0' } }] })
    await f.manager.cancel(batch.id)
    expect([...f.saved.values()].map(record => record.status)).not.toContain('succeeded')
    expect([...f.saved.values()].at(-1)?.status).toBe('cancelled')
    await f.manager.stop()
  })

  it('a failed result write leaves no accepted stage and reports the batch failure', async () => {
    const f = fixture({
      judge: async () => ({ kind: 'ok', operationId: 'op-1', attemptId: 'attempt-1', response: {
        answers: [{ id: 'stage', kind: 'choice', optionId: 'review_validation' }],
      } }),
      save: async record => { if (record.status === 'succeeded') throw new Error('disk full') },
    })
    const batch = await f.manager.start(request)
    let snapshot = await f.manager.read('session-1', new AbortController().signal)
    await vi.waitFor(async () => {
      snapshot = await f.manager.read('session-1', new AbortController().signal)
      expect(snapshot.batch?.status).toBe('failed')
    })
    expect(snapshot.batch?.status).toBe('failed')
    expect(snapshot.batch?.failure?.code).toBe('RECORD_FAILURE')
    expect(snapshot.turns[0]?.steps[0]?.analysis.status).toBe('failed')
    await f.manager.stop()
  })

  it('stops dispatching the remaining steps after an account rate limit', async () => {
    const history = [
      ...events.slice(0, -1),
      { seq: 5, type: 'step/start', data: { turn: 1, step: 2 }, time: 5 },
      { seq: 6, type: 'assistant/message', data: { turn: 1, step: 2,
        message: { id: 'assistant-2', role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text: 'Final answer' }] }, stream: [] }, time: 6 },
      { seq: 7, type: 'step/end', data: { turn: 1, step: 2 }, time: 7 },
      { seq: 8, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } }, time: 8 },
    ] as SessionEvent[]
    const f = fixture({ events: history, judge: async () => ({ kind: 'failed', operationId: 'quota-1',
      failure: { code: 'RATE_LIMIT', message: 'Jev rate limit' } }) })
    await f.manager.start(request)
    await vi.waitFor(async () => {
      const snapshot = await f.manager.read('session-1', new AbortController().signal)
      expect(snapshot.batch?.status).toBe('failed')
    })
    expect(f.judgeOnce).toHaveBeenCalledTimes(1)
    await f.manager.stop()
  })

  it('shows a failed explicit refresh while keeping the earlier valid judgment readable', async () => {
    let calls = 0
    const f = fixture({
      judge: async () => ++calls === 1
        ? { kind: 'ok', operationId: 'op-success', attemptId: 'attempt-1', response: {
          answers: [{ id: 'stage', kind: 'choice', optionId: 'implementation', confidence: 0.45 }],
        } }
        : { kind: 'failed', operationId: 'op-failure', failure: { code: 'INVALID_RESPONSE', message: 'Invalid Jev choice' } },
      getRecord: async () => ({ attemptRecords: [{ id: 'attempt-1', connection: { model: 'jev-fixture' }, request: { state: {}, questions: [] },
        rawResponse: { model: 'jev-1.13.0', answers: { stage: { choice: 'implementation' } } } }] }),
    })
    const first = await f.manager.start(request)
    await vi.waitFor(async () => {
      const snapshot = await f.manager.read('session-1', new AbortController().signal)
      expect(snapshot.batch?.status).toBe('completed')
      expect(snapshot.turns[0]?.steps[0]?.analysis.status).toBe('succeeded')
    })
    await f.manager.cancel(first.id)
    const second = await f.manager.start({ ...request, mode: 'refresh' })
    await vi.waitFor(async () => {
      const snapshot = await f.manager.read('session-1', new AbortController().signal)
      expect(snapshot.batch?.id).toBe(second.id)
      expect(snapshot.batch?.status).toBe('completed')
      expect(snapshot.turns[0]?.steps[0]?.analysis.status).toBe('failed')
    })
    const snapshot = await f.manager.read('session-1', new AbortController().signal)
    const analysis = snapshot.turns[0]!.steps[0]!.analysis
    expect(analysis.failure?.code).toBe('INVALID_RESPONSE')
    expect(analysis.previousResult).toMatchObject({ label: 'implementation', confidence: 0.45, stale: false })
    expect((await f.manager.detail('session-1', 'session-1:1'))?.status).toBe('failed')
    const earlier = await f.manager.detail('session-1', 'session-1:1', analysis.previousResult?.recordId)
    expect(earlier).toMatchObject({ status: 'succeeded', label: 'implementation', rawResponse: { model: 'jev-1.13.0' } })
    await f.manager.stop()
  })
})
