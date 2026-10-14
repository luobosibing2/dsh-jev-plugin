import { describe, expect, it, vi } from 'vitest'
import { createVolatile, updateVolatile } from '@deepseek-ai/cosmokit'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { harness, text, call, answer, visible } from './fixtures/supervision-harness.ts'

const evidenceAnswer = (value: string, evidence = 'no-supporting-evidence') => ({ answers: { assessment: { choice: value }, evidence: { choice: evidence } } })

describe('recorded evidence for drift and native Goal supervision', () => {
  it('offers one user requirement and a separate unsupported choice for drift', async () => {
    let h: Awaited<ReturnType<typeof harness>>
    h = await harness([call('inspect'), async () => {
      await vi.waitFor(async () => expect((await h.records()).items[0]?.status).toBe('succeeded'))
      return text('done')
    }], [answer('on-track')], { 'drift-monitoring': true }, { driftInterval: 1 })
    h.send('Investigate'); await h.agent.whenIdle()
    expect(h.requests).toHaveLength(1)
    const request = h.requests[0]
    const original = h.agent.session.deriveMessages().find(message => message.role === 'user' && message.source.kind === 'user')!
    expect(request.state.completeEvidence).toBe(true)
    expect(Object.keys(request.questions.evidence.criteria)).toEqual([original.id, 'no-supporting-evidence'])
    expect(request.questions.evidence.criteria['no-supporting-evidence']).toContain('None of the supplied requirements or records supports')
  })

  it('retains multiple recorded requirements and the unsupported choice', async () => {
    const amendment = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Also report the verification result.' }] })
    let h: Awaited<ReturnType<typeof harness>>
    h = await harness([() => {
      h.agent.session.append('user/message', amendment, { surfaceOp: 'append' })
      return call('inspect')
    }, async () => {
      await vi.waitFor(async () => expect((await h.records()).items[0]?.status).toBe('succeeded'))
      return text('done')
    }], [answer('on-track')], { 'drift-monitoring': true }, { driftInterval: 1 })
    h.send('Investigate'); await h.agent.whenIdle()
    const original = h.agent.session.deriveMessages().find(message => message.role === 'user' && message.source.kind === 'user')!
    expect(Object.keys(h.requests[0].questions.evidence.criteria)).toEqual([original.id, amendment.id, 'no-supporting-evidence'])
  })

  it.each(['on-track', 'drift'])('rejects unsupported %s background judgments without a reminder or a false empty-evidence note', async value => {
    const h = await harness([call('inspect'), text('done')], [evidenceAnswer(value)], { 'drift-monitoring': true }, { driftInterval: 1 })
    const ask = vi.fn(); h.ctx.on('user-questions/request', ask)
    h.send('Investigate'); await h.agent.whenIdle()
    await vi.waitFor(async () => expect((await h.records()).items[0]?.status).toBe('failed'))
    const record = await h.ctx.jev.getRecord((await h.records()).items[0]!.id)
    expect(record?.attemptRecords[0]?.failure?.code).toBe('UNDETERMINED')
    expect(record?.failure).toBeUndefined()
    expect(record?.receipts).toHaveLength(0)
    expect(ask).not.toHaveBeenCalled()
    expect(visible(h.agent)).not.toContain('Correction:')
  })

  it('records unavailable drift evidence without HTTP, blocking tools, or waking another step', async () => {
    const h = await harness([call('inspect'), text('done')], [], { 'drift-monitoring': true }, { driftInterval: 1, evidenceChars: 1 })
    const ask = vi.fn(); h.ctx.on('user-questions/request', ask)
    h.send('Investigate'); await h.agent.whenIdle()
    await vi.waitFor(async () => {
      const record = await h.ctx.jev.getRecord((await h.records()).items[0]!.id)
      expect(record?.failure?.message).toContain('no assessment was made')
    })
    const record = await h.ctx.jev.getRecord((await h.records()).items[0]!.id)
    expect(record?.failure?.code).toBe('UNDETERMINED')
    expect(record?.failure?.message).toContain('evidence character budget: 1')
    expect(record?.attemptRecords).toHaveLength(0)
    expect(record?.receipts).toHaveLength(0)
    expect(h.requests).toHaveLength(0)
    expect(h.model.requests).toHaveLength(2)
    expect(h.agent.session.snapshotEvents().filter(event => event.type === 'tool/result')).toHaveLength(1)
    expect(ask).not.toHaveBeenCalled()
  })

  it('denies native completion with no recorded history without HTTP or a human question', async () => {
    const h = await harness([], [], { 'goal-supervision': true })
    const goal = h.ctx.goals.create(h.agent, { objective: 'Investigate', maxGoalRounds: 1 })
    h.ctx.goals.pause(h.agent, { id: goal.id, revision: goal.revision })
    await h.agent.whenIdle()
    expect(h.agent.session.deriveMessages()).toHaveLength(0)
    const signal = new AbortController().signal
    const request = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Unrecorded request' }] })
    await agentEvents(h.ctx, h.agent).waterfall('agent/pre-step', { messages: [request], turn: 1, step: 1, signal },
      async () => ({ kind: 'enter', messages: [request] }))
    const ask = vi.fn(); h.ctx.on('user-questions/request', ask)
    const result = await h.ctx.agents.withInitiator(h.agent, () => h.ctx.tools.execute({
      name: 'update_goal', arguments: { action: 'complete', goal_id: goal.id, revision: goal.revision },
      agent: h.agent, signal, callId: ToolCallId('empty-history-complete'),
    }))
    expect(result.isError).toBe(true)
    expect(h.ctx.goals.get(h.agent)?.phase).toBe('paused')
    expect(h.requests).toHaveLength(0)
    expect(h.model.requests).toHaveLength(0)
    expect(ask).not.toHaveBeenCalled()
    const record = await h.ctx.jev.getRecord((await h.records()).items[0]!.id)
    expect(record?.status).toBe('failed')
    expect(record?.failure?.code).toBe('UNDETERMINED')
    expect(record?.failure?.message).toContain(request.id)
    expect(record?.attemptRecords).toHaveLength(0)
    expect(record?.receipts).toHaveLength(0)
  })

  it.each(['complete', 'omission', 'needs-user'])('denies native Goal completion when %s selects no supporting evidence', async value => {
    let h: Awaited<ReturnType<typeof harness>>
    h = await harness([() => {
      const goal = h.ctx.goals.get(h.agent)!
      return call('complete', 'update_goal', { action: 'complete', goal_id: goal.id, revision: goal.revision })
    }, text('Goal remains incomplete')], [evidenceAnswer(value)], { 'goal-supervision': true, 'completion-check': true })
    const ask = vi.fn(async () => ({ answers: [{ id: 'jev-resolution', selected: ['取消 / Cancel'] }] }))
    h.ctx.on('user-questions/request', ask)
    h.ctx.goals.create(h.agent, { objective: 'Complete the investigation', maxGoalRounds: 8 })
    await vi.waitFor(() => expect(h.ctx.goals.get(h.agent)?.phase).toBe('paused'))
    await h.agent.whenIdle()
    expect(h.requests).toHaveLength(1)
    expect(h.requests[0].state.mode).toBe('completion')
    expect(h.requests[0].state.completeEvidence).toBe(true)
    expect(ask).toHaveBeenCalledOnce()
    expect(h.model.requests).toHaveLength(2)
    const record = await h.ctx.jev.getRecord((await h.records()).items[0]!.id)
    expect(record?.status).toBe('cancelled')
    expect(record?.attemptRecords[0]?.failure?.code).toBe('UNDETERMINED')
    expect(record?.failure).toBeUndefined()
    expect(record?.receipts).toHaveLength(0)
  })

  it.each(['progress', 'no-progress', 'needs-user'])('does not adopt an unsupported %s Goal-round assessment', async value => {
    const h = await harness([text('Round answer')], [evidenceAnswer(value)], { 'goal-supervision': true })
    const ask = vi.fn(async () => ({ answers: [{ id: 'jev-resolution', selected: ['取消 / Cancel'] }] }))
    h.ctx.on('user-questions/request', ask)
    h.ctx.goals.create(h.agent, { objective: 'Investigate the cause', maxGoalRounds: 8 })
    await vi.waitFor(() => expect(h.ctx.goals.get(h.agent)?.phase).toBe('paused'))
    await h.agent.whenIdle()
    expect(ask).toHaveBeenCalledOnce()
    expect(h.requests).toHaveLength(1)
    const record = await h.ctx.jev.getRecord((await h.records()).items[0]!.id)
    expect(record?.status).toBe('cancelled')
    expect(record?.attemptRecords[0]?.failure?.code).toBe('UNDETERMINED')
    expect(record?.failure).toBeUndefined()
    expect(record?.receipts).toHaveLength(0)
  })

  it('does not complete a Goal or send HTTP when no work records fit the evidence budget', async () => {
    let h: Awaited<ReturnType<typeof harness>>
    h = await harness([() => {
      const goal = h.ctx.goals.get(h.agent)!
      return call('complete', 'update_goal', { action: 'complete', goal_id: goal.id, revision: goal.revision })
    }, text('Goal remains incomplete')], [], { 'goal-supervision': true, 'completion-check': true }, { evidenceChars: 1 })
    const ask = vi.fn(); h.ctx.on('user-questions/request', ask)
    h.ctx.goals.create(h.agent, { objective: 'Investigate', maxGoalRounds: 1 })
    await vi.waitFor(() => expect(h.model.requests).toHaveLength(2))
    await h.agent.whenIdle()
    expect(h.ctx.goals.get(h.agent)?.phase).not.toBe('complete')
    expect(h.requests).toHaveLength(0)
    expect(ask).not.toHaveBeenCalled()
    expect(h.errors).toHaveLength(0)
    expect(visible(h.agent)).toContain('Jev completion check did not provide usable evidence.')
    const records = await Promise.all((await h.records()).items.map(item => h.ctx.jev.getRecord(item.id)))
    expect(records).toHaveLength(2)
    for (const record of records) {
      expect(record?.status).toBe('failed')
      expect(record?.failure?.code).toBe('UNDETERMINED')
      expect(record?.failure?.message).toContain('no assessment was made')
      expect(record?.attemptRecords).toHaveLength(0)
      expect(record?.receipts).toHaveLength(0)
    }
  })

  it('does not turn partially omitted Goal evidence into a successful completion', async () => {
    let h: Awaited<ReturnType<typeof harness>>
    h = await harness([() => {
      const goal = h.ctx.goals.get(h.agent)!
      return call('complete', 'update_goal', { action: 'complete', goal_id: goal.id, revision: goal.revision })
    }, text('Goal remains incomplete')], [answer('complete')], { 'goal-supervision': true }, { evidenceChars: 1000 })
    h.ctx.on('user-questions/request', async () => ({ answers: [{ id: 'jev-resolution', selected: ['取消 / Cancel'] }] }))
    h.ctx.goals.create(h.agent, { objective: 'Investigate', maxGoalRounds: 1 })
    await vi.waitFor(() => expect(h.ctx.goals.get(h.agent)?.phase).toBe('paused'))
    await h.agent.whenIdle()
    expect(h.requests).toHaveLength(1)
    expect(h.requests[0].state.completeEvidence).toBe(false)
    expect(h.requests[0].state.messages.length).toBeGreaterThan(0)
    expect(h.requests[0].state.omittedMessages).toBeGreaterThan(0)
    const record = await h.ctx.jev.getRecord((await h.records()).items[0]!.id)
    expect(record?.status).toBe('cancelled')
    expect(record?.attemptRecords[0]?.failure?.code).toBe('UNDETERMINED')
    expect(record?.receipts).toHaveLength(0)
  })

  it('stops a Goal check when manual retry removes every record from the evidence budget', async () => {
    const h = await harness([text('Original round answer')], [{ answers: {} }], { 'goal-supervision': true })
    const ask = vi.fn(async () => {
      updateVolatile(h.counts.evidenceChars, createVolatile(1))
      return { answers: [{ id: 'jev-resolution', selected: ['重试 / Retry'] }] }
    })
    h.ctx.on('user-questions/request', ask)
    h.ctx.goals.create(h.agent, { objective: 'Investigate', maxGoalRounds: 1 })
    await vi.waitFor(() => expect(h.errors).toHaveLength(1))
    await h.agent.whenIdle()
    expect(ask).toHaveBeenCalledOnce()
    expect(h.requests).toHaveLength(1)
    expect(h.model.requests).toHaveLength(1)
    expect(h.errors).toEqual([expect.objectContaining({ code: 'UNDETERMINED' })])
    expect(visible(h.agent)).toContain('Original round answer')
    const records = (await h.records()).items
    expect(records).toHaveLength(1)
    const record = await h.ctx.jev.getRecord(records[0]!.id)
    expect(record?.status).toBe('failed')
    expect(record?.attemptRecords).toHaveLength(1)
    expect(record?.receipts).toHaveLength(0)
  })
})
