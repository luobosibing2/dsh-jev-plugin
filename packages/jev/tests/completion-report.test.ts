/** Current-turn completion review with native loop/Todo and local deterministic judgments. */
import { describe, expect, it, vi } from 'vitest'
import { createVolatile, updateVolatile } from '@deepseek-ai/cosmokit'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { Config } from '../src/supervision.ts'
import { completionReport, completionVerdict, completionPreflight } from '../src/completion-report.ts'
import { harness, text, call, answer, visible } from './fixtures/supervision-harness.ts'

const todo = (content: string, status: 'pending' | 'in_progress' | 'completed' = 'pending') =>
  call('todo-' + content, 'todo_write', { todos: [{ content, status }] })

describe('lightweight completion report', () => {
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid supplemental round configuration %s', value => {
    expect(() => Config({ maxSupplementRounds: value })).toThrow()
  })

  it('omits completion guidance for diagnostics, children and a native Goal turn after completion', async () => {
    let h: Awaited<ReturnType<typeof harness>>
    h = await harness([() => {
      const goal = h.ctx.goals.get(h.agent)!
      return call('finish-goal', 'update_goal', { action: 'complete', goal_id: goal.id, revision: goal.revision })
    }, text('Goal final reply')], [], { 'completion-check': true }, { autoTodo: true })
    const diagnostic = await h.ctx.systemPrompt.assemble({})
    expect(JSON.stringify(diagnostic.sections)).not.toContain('When updating an existing Todo')
    const child = await h.ctx.agents.create({ sessionId: SessionId('completion-child'), parentAgent: h.agent, agentOptions: { provider: 'fixture', model: 'fixture' } })
    const childPrompt = await h.ctx.systemPrompt.assemble({ agent: child.agent, scope: child.agent })
    expect(JSON.stringify(childPrompt.sections)).not.toContain('When updating an existing Todo')
    await child.dispose()
    const completed = new Promise<void>(resolve => h.ctx.on('goal/changed', ({ change }) => { if (change.goal?.phase === 'complete') resolve() }))
    h.ctx.goals.create(h.agent, { objective: 'Finish native Goal', maxGoalRounds: 3 })
    await completed; await h.agent.whenIdle()
    expect(h.model.requests).toHaveLength(2)
    for (const request of h.model.requests) expect(JSON.stringify(request.messages.filter(message => message.role === 'system'))).not.toContain('When updating an existing Todo')
    expect(h.requests).toHaveLength(0)
  })
  it('skips without Todo and injects the short native Todo guidance only when enabled', async () => {
    const h = await harness([text('simple answer'), text('next answer')], [], { 'completion-check': true }, { autoTodo: false })
    h.send('Simple task'); await h.agent.whenIdle()
    expect(h.requests).toHaveLength(0)
    expect(JSON.stringify(h.model.requests[0]?.messages)).toContain('When updating an existing Todo')
    updateVolatile(h.features, createVolatile({ 'completion-check': false }))
    h.send('Another simple task'); await h.agent.whenIdle()
    const currentSystem = h.model.requests[1]?.messages.filter(message => message.role === 'system')
    expect(JSON.stringify(currentSystem)).not.toContain('When updating an existing Todo')
  })

  it('accepts the native schema and checks pending Todo only at the stop point, without tools or reasoning', async () => {
    let h: Awaited<ReturnType<typeof harness>>
    h = await harness([todo('Inspect the report'), () => {
      expect(h.requests).toHaveLength(0)
      return call('probe')
    }, text('Observed report')], [answer('complete')], { 'completion-check': true }, { autoTodo: false })
    h.send('Inspect only; report results'); await h.agent.whenIdle()
    expect(h.errors).toHaveLength(0)
    expect(h.requests).toHaveLength(1)
    expect(h.requests[0].state.todos).toEqual([{ content: 'Inspect the report', status: 'pending' }])
    expect(h.requests[0].state.finalAnswer).toBe('Observed report')
    expect(Object.keys(h.requests[0].questions)).toEqual(['assessment', 'focus'])
    expect(JSON.stringify(h.requests[0])).not.toContain('No source change; investigation result')
    const events = h.agent.session.snapshotEvents()
    expect(events.findIndex(event => event.type === 'turn/start')).toBeLessThan(events.findIndex(event => event.type === 'user/message' && event.data.source.kind === 'user'))
  })

  it('keeps cleared Todo eligible and never substitutes an earlier final answer for empty final text', async () => {
    const h = await harness([todo('Work'), text('First report'), call('clear', 'todo_write', { todos: [] }), text('')],
      [answer('unknown'), answer('complete')], { 'completion-check': true }, { autoTodo: false, maxSupplementRounds: 3 })
    h.send('Do and explain the work'); await h.agent.whenIdle()
    expect(h.requests).toHaveLength(2)
    expect(h.requests[1].state.todos).toEqual([])
    expect(h.requests[1].state.finalAnswer).toBe('')
    expect(JSON.stringify(h.requests[1])).not.toContain('First report')
  })

  it('skips a later turn with an old Todo and scopes continue to its new user requirement', async () => {
    const h = await harness([todo('Historical work'), text('Old report'), text('No new Todo'), todo('Historical work copied by model'), text('Continued')],
      [answer('complete'), answer('complete')], { 'completion-check': true }, { autoTodo: false })
    h.send('Original historical task'); await h.agent.whenIdle()
    h.send('Simple next task'); await h.agent.whenIdle()
    expect(h.requests).toHaveLength(1)
    h.send('Continue'); await h.agent.whenIdle()
    expect(h.requests).toHaveLength(2)
    const input = h.requests[1].state
    expect(input.requirements.map((entry: { content: { text: string }[] }) => entry.content[0]?.text)).toEqual(['Continue'])
    expect(JSON.stringify(input)).not.toContain('Original historical task')
    expect(input.todos[0].content).toBe('Historical work copied by model')
  })

  it('retains all admitted current-turn adjustments in chronological order and excludes plugin supplements', async () => {
    let h: Awaited<ReturnType<typeof harness>>
    h = await harness([todo('Task'), () => {
      h.agent.steer(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Cancel the documentation requirement' }] }))
      return text('intermediate')
    }, text('Updated report'), text('Truthful supporting information')], [answer('unknown'), answer('complete')],
      { 'completion-check': true }, { autoTodo: false, maxSupplementRounds: 3 })
    h.send('Implement and document'); await h.agent.whenIdle()
    expect(h.requests).toHaveLength(2)
    for (const request of h.requests) expect(request.state.requirements.map((entry: { content: { text: string }[] }) => entry.content[0]?.text))
      .toEqual(['Implement and document', 'Cancel the documentation requirement'])
    expect(h.requests[1].state.finalAnswer).toBe('Truthful supporting information')
    expect(JSON.stringify(h.requests[1].state.requirements)).not.toContain('Supplement the current-turn report')
    expect(h.agent.session.snapshotEvents().filter(event => event.type === 'turn/start')).toHaveLength(1)
  })

  it('shares three default rounds across omission, unknown and contradiction, then reports exhausted unknown', async () => {
    const h = await harness(['First', 'Second', 'Third', 'Fourth'].map(text), ['omission', 'unknown', 'contradiction', 'unknown'].map(answer),
      { 'completion-check': true }, { maxSupplementRounds: 3 })
    const ask = vi.fn(); h.ctx.on('user-questions/request', ask)
    h.send('Finish this task'); await h.agent.whenIdle()
    expect(h.requests).toHaveLength(4)
    expect(h.model.requests).toHaveLength(4)
    expect(ask).not.toHaveBeenCalled()
    expect(h.requests.map(request => request.state.supplementsUsed)).toEqual([0, 1, 2, 3])
    expect(h.requests.map(request => request.state.finalAnswer)).toEqual(['First', 'Second', 'Third', 'Fourth'])
    const supplements = h.agent.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.kind === 'jev-supervision' && event.data.source.action === 'supplement')
    expect(supplements).toHaveLength(3)
    expect(h.agent.session.snapshotEvents().filter(event => event.type === 'turn/start')).toHaveLength(1)
    expect(visible(h.agent)).toContain('Supplemental round limit reached')
    expect(visible(h.agent)).toContain('材料不足') // final unknown remains visibly distinct from success
  })

  it.each(['complete', 'needs-user'])('ends early on %s despite remaining rounds', async value => {
    const h = await harness([text('first'), text('second')], [answer('omission'), answer(value)], { 'completion-check': true }, { maxSupplementRounds: 3 })
    h.send('Finish'); await h.agent.whenIdle()
    expect(h.requests).toHaveLength(2)
    expect(h.model.requests).toHaveLength(2)
    expect(visible(h.agent)).toContain(value === 'complete' ? 'Report review complete' : 'User choice or authorization required')
  })

  it('uses configured two rounds and preserves them across a malformed answer and manual retry', async () => {
    const h = await harness([text('first'), text('second'), text('third')], [answer('omission'), { answers: {} }, answer('contradiction'), answer('unknown')],
      { 'completion-check': true }, { maxSupplementRounds: 2 })
    let questions = 0
    h.ctx.on('user-questions/request', async request => {
      questions++
      expect(request.questions[0]?.detail).toContain('本次完成核查未完成')
      expect(h.model.requests).toHaveLength(2)
      return { answers: [{ id: 'jev-resolution', selected: ['重试 / Retry'] }] }
    })
    h.send('Finish'); await h.agent.whenIdle()
    expect(questions).toBe(1)
    expect(h.requests).toHaveLength(4)
    expect(h.model.requests).toHaveLength(3)
    expect(h.requests.map(request => request.state.supplementsUsed)).toEqual([0, 1, 1, 2])
    expect(visible(h.agent)).toContain('Supplemental round limit reached')
  })

  it('does not repeat the same stop-point judgment or supplement when the stopping hook is processed again', async () => {
    const h = await harness([text('first'), text('second')], [answer('omission'), answer('unknown')], { 'completion-check': true })
    let repeating = false
    h.ctx.on('agent/turn-stopping', async event => {
      if (repeating) return
      repeating = true
      try { await h.ctx.serial('agent/turn-stopping', event) }
      finally { repeating = false }
    })
    h.send('Finish'); await h.agent.whenIdle()
    expect(h.requests).toHaveLength(2)
    expect(h.model.requests).toHaveLength(2)
    const records = await Promise.all((await h.records()).items.map(record => h.ctx.jev.getRecord(record.id)))
    expect(records.filter(record => record?.receipts.some(receipt => receipt.id === 'supplement-reserved'))).toHaveLength(1)
  })

  it('shows a saved but unconfirmed supplement once and does not repeat judgment or business work', async () => {
    let h: Awaited<ReturnType<typeof harness>>
    h = await harness([async () => {
      const original = h.agent.session.deriveMessages().find(message => message.role === 'user' && message.source.kind === 'user')!
      const request = completionReport(h.agent, original.id, 0, 3, 24_000)!
      const result = await h.ctx.jev.judge({ featureId: 'completion-check', agent: h.agent, link: { sessionId: h.agent.id, inputVersion: original.id }, refresh: () => request })
      if (result.kind !== 'ok') throw new Error('Fixture could not create the saved prior judgment')
      await h.ctx.jev.writeReceipt(result.operationId, { id: 'supplement-reserved', status: 'observed', at: new Date().toISOString(), reason: 'Prior action outcome is unknown' })
      return text('Original result retained')
    }], [answer('omission')], { 'completion-check': true }, { maxSupplementRounds: 3 })
    let repeating = false
    h.ctx.on('agent/turn-stopping', async event => {
      if (repeating) return
      repeating = true
      try { await h.ctx.serial('agent/turn-stopping', event) }
      finally { repeating = false }
    })
    h.send('Review the work'); await h.agent.whenIdle()
    expect(h.requests).toHaveLength(1)
    expect(h.model.requests).toHaveLength(1)
    expect(h.errors).toHaveLength(0)
    const messages = h.agent.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.kind === 'jev-supervision')
    expect(messages).toHaveLength(1)
    expect(visible(h.agent)).toContain('上次补充状态未确认，本次完成核查未完成')
    expect(visible(h.agent)).toContain('Original result retained')
  })

  it('records complete oversized input without sending and retries with the increased live budget', async () => {
    const requirement = 'Full current requirement ' + 'x'.repeat(4_000)
    const h = await harness([text('reported')], [answer('complete')], { 'completion-check': true }, { evidenceChars: 100 })
    let questions = 0
    h.ctx.on('user-questions/request', async request => {
      questions++
      expect(h.requests).toHaveLength(0)
      expect(request.questions[0]?.detail).toContain('核查材料超出预算，本次完成核查未完成')
      const record = await h.ctx.jev.getRecord((await h.records()).items[0]!.id)
      expect(JSON.stringify(record?.attemptRecords[0]?.request)).toContain(requirement)
      updateVolatile(h.counts.evidenceChars, createVolatile(24_000))
      return { answers: [{ id: 'jev-resolution', selected: ['重试 / Retry'] }] }
    })
    h.send(requirement); await h.agent.whenIdle()
    expect(questions).toBe(1)
    expect(h.requests).toHaveLength(1)
    expect(JSON.stringify(h.requests[0].state)).toContain(requirement)
    expect(h.requests[0].state.supplementsUsed).toBe(0)
    expect(h.model.requests).toHaveLength(1)
  })

  it('waits for explicit cancel after invalid focus while preserving the shown answer', async () => {
    const h = await harness([text('Keep my original answer')], [{ answers: { assessment: { choice: 'complete' }, focus: { choice: 'invented-reference' } } }], { 'completion-check': true })
    let resolve!: (answer: { answers: { id: string; selected: string[] }[] }) => void
    const asked = new Promise<void>(ready => h.ctx.on('user-questions/request', request => {
      expect(request.questions[0]?.detail).toContain('本次完成核查未完成')
      ready(); return new Promise(answer => { resolve = answer })
    }))
    h.send('Review'); await asked
    expect(h.agent.status).toBe('running')
    expect(visible(h.agent)).toContain('Keep my original answer')
    expect(h.model.requests).toHaveLength(1)
    resolve({ answers: [{ id: 'jev-resolution', selected: ['取消 / Cancel'] }] })
    await h.agent.whenIdle()
    expect(h.requests).toHaveLength(1)
    expect((await h.records()).items[0]?.status).toBe('cancelled')
    expect(visible(h.agent)).not.toContain('Report review complete')
  })

  it('does not adopt a delayed judgment after new user work arrives', async () => {
    let release!: (value: object) => void
    const pending = new Promise<object>(resolve => { release = resolve })
    const h = await harness([text('old answer'), text('new answer')], [() => pending, answer('complete')], { 'completion-check': true }, { maxSupplementRounds: 3 })
    h.send('Old task'); await h.requestSeen(1)
    h.send('New requirement')
    release(answer('omission'))
    await h.agent.whenIdle()
    expect(h.model.requests).toHaveLength(2)
    expect(visible(h.agent)).not.toContain('Supplement the current-turn report')
    const records = await Promise.all((await h.records()).items.map(record => h.ctx.jev.getRecord(record.id)))
    expect(records.some(record => record?.receipts.some(receipt => receipt.status === 'not-adopted'))).toBe(true)
  })

  it('does not substitute a derived summary when original current-turn requirements are missing', async () => {
    const h = await harness([text('report')], [], {})
    h.model.beforeReply = () => h.agent.session.append('todo/write', { todos: [] })
    h.send('Original requirement'); await h.agent.whenIdle()
    const direct = h.agent.session.deriveMessages().find(message => message.role === 'user' && message.source.kind === 'user')!
    const request = completionReport(h.agent, direct.id, 0, 3, 24_000)!
    expect(request.state).toMatchObject({ originalRequirementsAvailable: true })
    const missing = completionReport(h.agent, 'missing-original', 0, 3, 24_000)!
    expect(missing.state).toMatchObject({ originalRequirementsAvailable: false })
    expect(() => completionPreflight(missing, 24_000)).toThrow('本轮原始要求缺失，本次完成核查未完成')
    const invalidResponse = { answers: [{ id: 'assessment', kind: 'choice' as const, optionId: 'unknown' }, { id: 'focus', kind: 'choice' as const, optionId: 'invented' }] }
    expect(completionVerdict(invalidResponse, missing)).toBeUndefined()
  })
})
