import { describe, expect, it, vi } from 'vitest'
import { createVolatile, updateVolatile } from '@deepseek-ai/cosmokit'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { JevLedger } from '../src/ledger.ts'
import * as supervision from '../src/supervision.ts'
import { harness, text, call, answer, visible, cleanups } from './fixtures/supervision-harness.ts'

describe('supervision through real AgentLoop, goal driver, tools and HTTP Jev', () => {
  it.each([24_000, 1])('keeps drift evidence choices valid with a %s-character budget', async evidenceChars => {
    const h = await harness([call('one'), text('done')], [answer('on-track')], { 'drift-monitoring': true }, { driftInterval: 1, evidenceChars })
    h.send('Investigate'); await h.agent.whenIdle()
    await h.requestSeen(1)
    const criteria = h.requests[0].questions.evidence.criteria
    expect(Object.keys(criteria).length).toBeGreaterThanOrEqual(2)
    expect(criteria['insufficient-evidence']).toContain('unknown')
    if (evidenceChars === 1) {
      await vi.waitFor(async () => expect((await h.records()).items[0]?.status).toBe('failed'))
      expect(visible(h.agent)).not.toContain('Correction:')
    } else {
      expect(Object.values(criteria)).toContain('[{"type":"text","text":"Investigate"}]')
    }
    expect(h.errors).toHaveLength(0)
  })

  it('never adopts a drift correction citing the insufficient-evidence alternative', async () => {
    let h: Awaited<ReturnType<typeof harness>>
    h = await harness([call('one'), async () => {
      await vi.waitFor(async () => expect((await h.records()).items[0]?.status).toBe('failed'))
      return text('done')
    }], [{ answers: { assessment: { choice: 'drift' }, evidence: { choice: 'insufficient-evidence' } } }],
    { 'drift-monitoring': true }, { driftInterval: 1 })
    h.send('Investigate'); await h.agent.whenIdle()
    expect(visible(h.agent)).not.toContain('Correction:')
    expect(h.errors).toHaveLength(0)
    const record = await h.ctx.jev.getRecord((await h.records()).items[0]!.id)
    expect(record?.attemptRecords[0]?.failure?.code).toBe('UNDETERMINED')
  })

  it('registers independent disabled switches and count defaults without making requests', async () => {
    const h = await harness([text('done')], [])
    expect((await h.ctx.jev.listFeatures()).map(feature => [feature.id, feature.enabled])).toEqual([
      ['drift-monitoring', false], ['completion-check', false], ['goal-supervision', false],
    ])
    expect(supervision.Config({}).driftInterval.get()).toBe(6)
    expect(supervision.Config({}).noProgressRounds.get()).toBe(3)
    expect(supervision.Config({}).maxSupplementRounds.get()).toBe(3)
    expect(() => supervision.Config({ driftInterval: 0 })).toThrow()
    h.send('Do the task'); await h.agent.whenIdle()
    expect(h.requests).toHaveLength(0)
  })

  it('shows the original answer, performs one supplement, then stops on remaining omissions', async () => {
    const h = await harness([text('I am done'), text('Still no test result')], [answer('omission'), answer('omission')], { 'completion-check': true })
    h.send('Implement and test it'); await h.agent.whenIdle()
    expect(h.model.requests).toHaveLength(2)
    expect(h.requests).toHaveLength(2)
    const content = visible(h.agent)
    expect(content.indexOf('I am done')).toBeLessThan(content.indexOf('Supplement the current-turn report'))
    expect(content).toContain('Address this single issue within existing authorization')
    expect(content).toContain('do not redo unrelated completed work or invent results')
    expect(content).toContain('No further automatic work')
    const records = await h.records()
    expect(records.items).toHaveLength(2)
    const details = await Promise.all(records.items.map(record => h.ctx.jev.getRecord(record.id)))
    expect(details.filter(record => record?.receipts.some(receipt => receipt.id === 'supplement-reserved'))).toHaveLength(1)
  })

  it('sends completion evidence rules and distinct assessment criteria to the judge', async () => {
    const h = await harness([call('inspect'), text('Investigation finished')], [answer('complete')], { 'completion-check': true })
    h.send('Inspect only; do not repair files'); await h.agent.whenIdle()
    expect(h.requests).toHaveLength(1)
    const request = h.requests[0]
    expect(Object.keys(request.questions)).toEqual(['assessment', 'focus'])
    for (const question of Object.values(request.questions) as { criteria: object }[]) expect(Object.keys(question.criteria).length).toBeGreaterThanOrEqual(2)
    expect(request.state.requirements[0].content[0].text).toBe('Inspect only; do not repair files')
    expect(JSON.stringify(request)).not.toContain('No source change; investigation result')
    expect(request.state.rules).toContain('running and truthfully reporting failed tests can satisfy a run-and-report request')
    expect(request.state.rules).toContain('a fix-and-pass request remains unmet')
    expect(Object.keys(request.questions.assessment.criteria)).toEqual(['complete', 'omission', 'contradiction', 'needs-user', 'unknown'])
  })

  it('starts the sixth-step check without delaying the seventh model request and never wakes a completed task', async () => {
    let release!: (value: object) => void
    const waiting = new Promise<object>(resolve => { release = resolve })
    const h = await harness([...Array.from({ length: 6 }, (_, i) => call('probe-' + i)), text('done')], [() => waiting], { 'drift-monitoring': true })
    h.send('Investigate'); await h.agent.whenIdle()
    await vi.waitFor(() => expect(h.requests).toHaveLength(1))
    expect(h.model.requests).toHaveLength(7)
    release(answer('drift'))
    await vi.waitFor(async () => expect((await h.records()).items[0]?.status).toBe('succeeded'))
    expect(h.model.requests).toHaveLength(7)
    expect(visible(h.agent)).not.toContain('Correction:')
  })

  it('delivers drift once in a later real step and leaves tools running', async () => {
    let h: Awaited<ReturnType<typeof harness>>
    h = await harness([call('one'), async () => {
      await vi.waitFor(async () => expect((await h.records()).items[0]?.status).toBe('succeeded'))
      return call('two')
    }, text('I did not change course')], [answer('drift'), answer('drift')], { 'drift-monitoring': true }, { driftInterval: 1 })
    h.send('Investigate'); await h.agent.whenIdle()
    expect(h.model.requests).toHaveLength(3)
    expect(visible(h.agent).match(/Correction:/g)).toHaveLength(1)
    expect(h.agent.session.snapshotEvents().filter(event => event.type === 'tool/result')).toHaveLength(2)
  })

  it('records malformed background answers without a human wait or interruption', async () => {
    const h = await harness([call('one'), text('done')], [{ answers: {} }], { 'drift-monitoring': true }, { driftInterval: 1 })
    const ask = vi.fn(); h.ctx.on('user-questions/request', ask)
    h.send('Investigate'); await h.agent.whenIdle()
    await vi.waitFor(async () => expect((await h.records()).items.some(item => item.status === 'failed')).toBe(true))
    expect(ask).not.toHaveBeenCalled()
    expect(h.model.requests).toHaveLength(2)
  })

  it('pauses the native goal after three no-progress rounds without a second completion continuation', async () => {
    const h = await harness([text('same failure'), text('same failure'), text('same failure')], Array.from({ length: 3 }, () => answer('no-progress')), { 'goal-supervision': true, 'completion-check': true })
    h.ctx.goals.create(h.agent, { objective: 'Fix it', maxGoalRounds: 8 })
    await vi.waitFor(() => expect(h.ctx.goals.get(h.agent)?.phase).toBe('paused'))
    await h.agent.whenIdle()
    expect(h.ctx.goals.get(h.agent)?.roundsStarted).toBe(3)
    expect(h.model.requests).toHaveLength(3)
    expect(h.requests.map(request => request.state.mode)).toEqual(['progress', 'progress', 'progress'])
  })

  it('resets the consecutive count for new investigation evidence', async () => {
    const h = await harness(Array.from({ length: 6 }, () => text('investigation')), ['no-progress', 'no-progress', 'progress', 'no-progress', 'no-progress', 'no-progress'].map(value => answer(value)), { 'goal-supervision': true })
    let resolvePaused!: () => void
    const paused = new Promise<void>(resolve => { resolvePaused = resolve })
    const unsubscribe = h.ctx.on('goal/changed', ({ agent, change }) => {
      if (agent === h.agent && change.goal?.phase === 'paused') resolvePaused()
    })
    cleanups.push(async () => { unsubscribe() })
    try {
      h.ctx.goals.create(h.agent, { objective: 'Find root cause', maxGoalRounds: 9 })
      await paused
    } finally { unsubscribe() }
    expect(h.ctx.goals.get(h.agent)?.phase).toBe('paused')
    expect(h.ctx.goals.get(h.agent)?.roundsStarted).toBe(6)
    expect(h.requests).toHaveLength(6)
  })

  it('blocks the model complete tool but leaves native manual completion available', async () => {
    let h: Awaited<ReturnType<typeof harness>>
    h = await harness([() => {
      const goal = h.ctx.goals.get(h.agent)!
      return call('complete', 'update_goal', { action: 'complete', goal_id: goal.id, revision: goal.revision })
    }, text('Still pending')], [answer('omission'), answer('needs-user')], { 'goal-supervision': true })
    let resolvePaused!: () => void
    const paused = new Promise<void>(resolve => { resolvePaused = resolve })
    const unsubscribe = h.ctx.on('goal/changed', ({ agent, change }) => {
      if (agent === h.agent && change.goal?.phase === 'paused') resolvePaused()
    })
    cleanups.push(async () => { unsubscribe() })
    try {
      h.ctx.goals.create(h.agent, { objective: 'Test changes', maxGoalRounds: 8 })
      await paused
    } finally { unsubscribe() }
    expect(h.ctx.goals.get(h.agent)?.phase).toBe('paused')
    const goal = h.ctx.goals.get(h.agent)!
    expect(visible(h.agent)).toContain('Jev:')
    h.ctx.goals.complete(h.agent, { id: goal.id, revision: goal.revision })
    expect(h.ctx.goals.get(h.agent)?.phase).toBe('complete')
  })

  it('keeps a failed completion check waiting and refreshes recorded evidence after manual retry', async () => {
    const h = await harness([text('done')], [{ answers: {} }, answer('complete')], { 'completion-check': true })
    let resolve!: (value: { answers: { id: string; selected: string[] }[] }) => void
    const asked = new Promise<void>(ready => { h.ctx.on('user-questions/request', () => { ready(); return new Promise(answer => { resolve = answer }) }) })
    h.send('Do it'); await asked
    expect(visible(h.agent)).toContain('done')
    expect(h.agent.status).toBe('running')
    resolve({ answers: [{ id: 'jev-resolution', selected: ['重试 / Retry'] }] })
    await h.agent.whenIdle()
    expect(h.requests).toHaveLength(2)
    expect((await h.ctx.jev.getRecord((await h.records()).items[0]!.id))?.attemptRecords).toHaveLength(2)
  })
  it('does not turn cropped evidence into a successful completion', async () => {
    const h = await harness([text('done')], [answer('complete')], { 'completion-check': true }, { evidenceChars: 30 })
    h.ctx.on('user-questions/request', async () => ({ answers: [{ id: 'jev-resolution', selected: ['取消 / Cancel'] }] }))
    h.send('Implement the full requirement with current tests'); await h.agent.whenIdle()
    expect(h.requests).toHaveLength(0)
    const record = await h.ctx.jev.getRecord((await h.records()).items[0]!.id)
    expect(record?.status).toBe('cancelled')
    expect(record?.attemptRecords[0]?.failure?.code).toBe('COMPLETION_BUDGET')
    expect(record?.attemptRecords[0]?.request.state).toMatchObject({ finalAnswer: 'done' })
    expect(record?.receipts).toHaveLength(0)
  })

  it('cancels a failed goal check, pauses native continuation, and keeps another queued user request', async () => {
    const h = await harness([text('goal answer'), text('queued user answer')], [{ answers: {} }], { 'goal-supervision': true })
    let resolve!: (value: { answers: { id: string; selected: string[] }[] }) => void
    const asked = new Promise<void>(ready => { h.ctx.on('user-questions/request', () => { ready(); return new Promise(answer => { resolve = answer }) }) })
    h.ctx.goals.create(h.agent, { objective: 'Test all changes', maxGoalRounds: 8 })
    await asked
    h.send('An independent user request')
    resolve({ answers: [{ id: 'jev-resolution', selected: ['取消 / Cancel'] }] })
    await h.agent.whenIdle()
    expect(h.ctx.goals.get(h.agent)?.phase).toBe('paused')
    expect(h.model.requests).toHaveLength(2)
    expect(visible(h.agent)).toContain('queued user answer')
  })

  it('does not allow a stale completion answer to change an edited goal', async () => {
    let release!: (value: object) => void
    const pending = new Promise<object>(resolve => { release = resolve })
    let h: Awaited<ReturnType<typeof harness>>
    h = await harness([() => { const goal = h.ctx.goals.get(h.agent)!; return call('complete', 'update_goal', { action: 'complete', goal_id: goal.id, revision: goal.revision }) }, text('denied')], [() => pending, answer('needs-user')], { 'goal-supervision': true })
    h.ctx.goals.create(h.agent, { objective: 'Original goal', maxGoalRounds: 8 })
    await vi.waitFor(() => expect(h.requests).toHaveLength(1))
    const goal = h.ctx.goals.get(h.agent)!
    h.ctx.goals.edit(h.agent, { id: goal.id, revision: goal.revision }, { objective: 'Revised goal' })
    release(answer('complete'))
    await vi.waitFor(() => expect(h.ctx.goals.get(h.agent)?.phase).toBe('paused'))
    expect(h.ctx.goals.get(h.agent)?.objective).toBe('Revised goal')
    const details = await Promise.all((await h.records()).items.map(record => h.ctx.jev.getRecord(record.id)))
    expect(details.some(record => record?.receipts.some(receipt => receipt.status === 'not-adopted'))).toBe(true)
  })

  it('checks an ordinary request when the retained native goal is already complete', async () => {
    const h = await harness([text('done')], [answer('complete')], { 'completion-check': true })
    const goal = h.ctx.goals.create(h.agent, { objective: 'Old goal', maxGoalRounds: 8 })
    h.ctx.goals.complete(h.agent, { id: goal.id, revision: goal.revision })
    await h.agent.whenIdle()
    h.send('New unrelated work'); await h.agent.whenIdle()
    expect(h.requests).toHaveLength(1)
    expect(h.requests[0].state.mode).toBe('completion')
  })

  it('keeps a disabled interactive check waiting until cancellation without another request', async () => {
    const h = await harness([text('done')], [{ answers: {} }], { 'completion-check': true })
    let prompts = 0
    h.ctx.on('user-questions/request', async () => {
      prompts++
      if (prompts === 1) {
        updateVolatile(h.features, createVolatile({ 'completion-check': false }))
        return { answers: [{ id: 'jev-resolution', selected: ['重试 / Retry'] }] }
      }
      return { answers: [{ id: 'jev-resolution', selected: ['取消 / Cancel'] }] }
    })
    h.send('Do it'); await h.agent.whenIdle()
    expect(prompts).toBe(2)
    expect(h.requests).toHaveLength(1)
    expect(h.model.requests).toHaveLength(1)
  })

  it('excludes a long finished task before budgeting the current short request', async () => {
    const h = await harness([text('old done'), text('current done')], [answer('complete')], {}, { evidenceChars: 10_000, autoTodo: true })
    h.send('Old unrelated task ' + 'x'.repeat(8_000)); await h.agent.whenIdle()
    updateVolatile(h.features, createVolatile({ 'completion-check': true }))
    h.send('Say current done'); await h.agent.whenIdle()
    expect(h.requests).toHaveLength(1)
    expect(h.requests[0].state.originalRequirementsAvailable).toBe(true)
    expect(JSON.stringify(h.requests)).not.toContain('Old unrelated task')
    expect((await h.records()).items[0]?.status).toBe('succeeded')
  })

  it('reopens persisted records and Session without resending or resetting the original request supplement allowance', async () => {
    const first = await harness([text('first answer'), text('supplement answer')], [answer('omission'), answer('omission')], { 'completion-check': true })
    first.send('Implement and test'); await first.agent.whenIdle()
    const original = first.agent.session.deriveMessages().find(message => message.role === 'user' && message.source.kind === 'user')!
    const supplement = first.agent.session.deriveMessages().find(message => message.role === 'user' && message.source.kind === 'jev-supervision' && message.source.action === 'supplement')!
    await first.dispose()
    const second = await harness([text('same original work')], [answer('omission')], { 'completion-check': true }, {}, { root: first.root, id: first.agent.id })
    expect(second.model.requests).toHaveLength(0)
    expect(second.requests).toHaveLength(0)
    expect(second.agent.session.deriveMessages().some(message => message.id === original.id)).toBe(true)
    if (supplement.role !== 'user') throw new Error('Expected recorded supplement')
    second.agent.steer(createUserMessage({ source: supplement.source, content: [{ type: 'text', text: 'Continue the original work once after an explicit wake' }] }))
    await second.agent.whenIdle()
    expect(second.model.requests).toHaveLength(1)
    expect(second.requests).toHaveLength(0)
    expect((await second.records()).items).toHaveLength(3)
    expect((await second.ctx.jev.getRecord((await second.records()).items[0]!.id))?.attemptRecords[0]?.failure?.code).toBe('COMPLETION_INPUT_MISSING')
  })

  it('does not send or adopt an unlogged background attempt and still completes the main Agent', async () => {
    const h = await harness([call('one'), text('done')], [answer('drift')], { 'drift-monitoring': true }, { driftInterval: 1 })
    vi.spyOn(JevLedger.prototype, 'startAttempt').mockRejectedValueOnce(new Error('fixture disk write failed'))
    h.send('Investigate'); await h.agent.whenIdle()
    expect(h.model.requests).toHaveLength(2)
    expect(h.requests).toHaveLength(0)
    expect(visible(h.agent)).not.toContain('Correction:')
  })

  it('does not deliver a background answer whose result write failed', async () => {
    const h = await harness([call('one'), async () => {
      await vi.waitFor(async () => expect((await h.records()).items[0]?.status).toBe('failed'))
      return call('two')
    }, text('done')], [answer('drift')], { 'drift-monitoring': true }, { driftInterval: 1 })
    vi.spyOn(JevLedger.prototype, 'settleAttempt').mockRejectedValueOnce(new Error('fixture result write failed'))
    h.send('Investigate'); await h.agent.whenIdle()
    expect(h.model.requests).toHaveLength(3)
    expect(visible(h.agent)).not.toContain('Correction:')
  })

  it('resets the stalled-round count after the user resumes a paused native goal', async () => {
    const h = await harness(Array.from({ length: 6 }, () => text('same failure')), Array.from({ length: 6 }, () => answer('no-progress')), { 'goal-supervision': true })
    h.ctx.goals.create(h.agent, { objective: 'Fix it', maxGoalRounds: 9 })
    await vi.waitFor(() => expect(h.ctx.goals.get(h.agent)?.phase).toBe('paused'))
    const paused = h.ctx.goals.get(h.agent)!
    h.ctx.goals.resume(h.agent, { id: paused.id, revision: paused.revision })
    await vi.waitFor(() => expect(h.ctx.goals.get(h.agent)?.roundsStarted).toBe(6))
    await vi.waitFor(() => expect(h.ctx.goals.get(h.agent)?.phase).toBe('paused'))
    expect(h.model.requests).toHaveLength(6)
  })

  it('preserves an earlier public tool denial without running a completion judgment', async () => {
    let h: Awaited<ReturnType<typeof harness>>
    h = await harness([() => { const goal = h.ctx.goals.get(h.agent)!; return call('complete', 'update_goal', { action: 'complete', goal_id: goal.id, revision: goal.revision }) }, text('not allowed')], [answer('needs-user')], { 'goal-supervision': true })
    h.ctx.on('tools/pre-execute', async (exec, next) => exec.name === 'update_goal' ? { kind: 'deny', reason: 'Earlier authority denied completion' } : next())
    h.ctx.goals.create(h.agent, { objective: 'Goal', maxGoalRounds: 8 })
    await vi.waitFor(() => expect(h.ctx.goals.get(h.agent)?.phase).toBe('paused'))
    expect(h.requests).toHaveLength(1)
    expect(h.requests[0].state.mode).toBe('progress')
    expect(visible(h.agent)).toContain('Earlier authority denied completion')
  })

})
