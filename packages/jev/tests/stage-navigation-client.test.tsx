// @vitest-environment jsdom
/** Session source navigation with fixed Host replies; no model call runs here. */

import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ButtonHTMLAttributes } from 'react'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { StageNavigationSnapshot, StageStep, StageTurn } from '../src/stage-types.ts'
import { StageNavigation, type StageNavigationRemote } from '../src/client/StageNavigation.tsx'
import { stageEn, stageZh } from '../src/client/stage-locales.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ children, variant: _variant, size: _size, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => <button type="button" {...props}>{children}</button>,
  StateDot: () => <span aria-hidden="true" />,
}))

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function step(turn: number, number: number, label: 'implementation' | 'review_validation', text: string): StageStep {
  const assistant: NonNullable<StageStep['assistant']> = { seq: turn * 100 + number * 10 + 1, interrupted: false, content: [
      { type: 'reasoning', text: `Thinking about ${text}` }, { type: 'text', text },
      { type: 'tool-call', id: ToolCallId(`call-${turn}-${number}`), name: 'read', arguments: '{"path":"source.ts"}' },
    ] }
  return {
    id: `session-${turn}:step-${number}`, turn, step: number, startSeq: turn * 100 + number * 10,
    endSeq: turn * 100 + number * 10 + 9, status: 'complete', classifiable: true, materialStatus: 'ready', assistant, messages: [assistant],
    tools: [{ callId: `call-${turn}-${number}`, name: 'read', arguments: '{"path":"source.ts"}', seq: turn * 100 + number * 10 + 2, dispatched: true,
      result: { seq: turn * 100 + number * 10 + 3, isError: number === 2, content: [{ type: 'text', text: number === 2 ? 'read failed' : 'source content' }] } }],
    attemptSeqs: [], analysis: { status: 'succeeded', label, confidence: number === 1 ? 0.45 : 0.57, model: 'jev-1.13.0' },
  }
}

function turn(number: number, steps: StageStep[]): StageTurn {
  return {
    id: `session-${number}:turn`, turn: number, startSeq: number * 100, endSeq: number * 100 + 99,
    reason: number === 2 ? { kind: 'aborted', reason: { kind: 'user' } } : { kind: 'completed' },
    requests: [{ seq: number * 100, content: [{ type: 'text', text: `Request for turn ${number}` }] }], steps,
  }
}

function snapshot(sessionId = 'session'): StageNavigationSnapshot {
  return { sessionId, cursor: 299, featureEnabled: true, turns: [
    turn(1, [step(1, 1, 'implementation', 'Implement the change')]),
    turn(2, [step(2, 1, 'review_validation', 'Check the result'), step(2, 2, 'implementation', 'Repair after check')]),
  ] }
}

function remote(value = snapshot()): StageNavigationRemote {
  let current = value
  return {
    getStageNavigation: vi.fn(async () => current),
    startStageAnalysis: vi.fn(async request => {
      const batch = { id: 'batch-1', sessionId: request.sessionId, status: 'running' as const, total: 2, completed: 0, failed: 0, cancelled: 0 }
      current = { ...current, batch }
      return batch
    }),
    cancelStageAnalysis: vi.fn(async () => { if (current.batch) current = { ...current, batch: { ...current.batch, status: 'cancelled' } } }),
    getStageAnalysisRecord: vi.fn(async (_sessionId, stepId) => ({
      id: 'record-1', sessionId: 'session', stepId, revision: 1, sourceFingerprint: 'source-hash', ruleVersion: 'v1',
      status: 'succeeded', label: 'implementation', confidence: 0.45,
      request: { system: 'stage', state: { step: 1 }, choices: ['implementation', 'unknown'] },
      rawResponse: { choice: 'implementation', confidence: 0.45 },
    })),
  }
}

function view(sessionId: string, jev: StageNavigationRemote) {
  return <StageNavigation sessionId={sessionId} jev={jev} openView={() => {}} t={key => stageEn[key]} />
}

describe('stage navigation view', () => {
  it('localizes completed batch progress instead of exposing the wire status', async () => {
    const value = snapshot()
    render(<StageNavigation sessionId="session" jev={remote({ ...value, batch: {
      id: 'batch-complete', sessionId: 'session', status: 'completed', total: 2, completed: 2, failed: 0, cancelled: 0,
    } })} openView={() => {}} t={key => stageZh[key]} />)
    expect(await screen.findByText('分析进度: 2 / 2 · 已结束')).toBeTruthy()
  })

  it('renders every recorded reasoning block, later assistant message, and both tool results in one step', async () => {
    const original = step(1, 1, 'implementation', 'Final text')
    const manyReasoning = Array.from({ length: 17 }, (_, index) => ({ type: 'reasoning' as const, text: `Reasoning block ${index + 1}` }))
    const firstMessage: NonNullable<StageStep['assistant']> = { seq: 111, interrupted: false, content: manyReasoning }
    const complete = {
      ...original, messages: [firstMessage, original.assistant!],
      tools: [...original.tools, { callId: 'call-second', name: 'test', arguments: '{}', seq: 115, dispatched: true,
        result: { seq: 116, isError: false, content: [{ type: 'text' as const, text: 'second tool result' }] } }],
    }
    const jev = remote({ sessionId: 'session', cursor: 199, featureEnabled: true, turns: [turn(1, [complete])] })
    render(view('session', jev))
    expect(await screen.findByText('Final text')).toBeTruthy()
    expect(screen.getByText('Reasoning block 1')).toBeTruthy()
    expect(screen.getByText('Reasoning block 17')).toBeTruthy()
    expect(screen.getByText(/Tool calls and results · 2/)).toBeTruthy()
    fireEvent.click(screen.getByText('test', { selector: 'span' }))
    expect(screen.getByText(/second tool result/)).toBeTruthy()
    expect(jev.startStageAnalysis).not.toHaveBeenCalled()
  })

  it('returns to native chat without showing stage content if Host disables the feature', async () => {
    const openView = vi.fn()
    render(<StageNavigation sessionId="session" jev={remote({ ...snapshot(), featureEnabled: false })} openView={openView} t={key => stageEn[key]} />)
    await waitFor(() => { expect(openView).toHaveBeenCalledWith('chat', '') })
    expect(screen.queryByRole('region', { name: 'Stage navigation' })).toBeNull()
  })

  it('keeps all turns in navigation, filters only source, and preserves recorded signals', async () => {
    const jev = remote()
    render(view('session', jev))
    expect(await screen.findByText('Request for turn 2')).toBeTruthy()
    expect(jev.startStageAnalysis).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /Turn 1 · Request for turn 1/ }))
    expect(screen.getByText('Implement the change')).toBeTruthy()
    expect(screen.getByText(/Confidence: 0.45/)).toBeTruthy()
    fireEvent.click(screen.getByText('Think / reasoning · 1'))
    expect(screen.getByText('Thinking about Implement the change')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Classification input and response' }))
    expect(await screen.findByText(/"confidence": 0.45/)).toBeTruthy()
    expect(jev.getStageAnalysisRecord).toHaveBeenCalledWith('session', 'session-1:step-1')

    fireEvent.click(screen.getByRole('button', { name: /Turn 2 · Request for turn 2/ }))
    expect(screen.getByRole('heading', { name: /Turn 2 · Aborted/ })).toBeTruthy()
    expect(screen.getByText('Repair after check')).toBeTruthy()
    expect(screen.getAllByText('Tool reported an error').length).toBeGreaterThan(0)
    fireEvent.change(screen.getByLabelText('Search this turn’s source'), { target: { value: 'Repair after check' } })
    expect(screen.queryByText('Check the result')).toBeNull()
    expect(screen.getByText('Repair after check')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Turn 1 · Request for turn 1/ })).toBeTruthy()
    expect(jev.startStageAnalysis).not.toHaveBeenCalled()
  })

  it('starts only the selected completed turn and exposes cancellation progress', async () => {
    const value = snapshot()
    const selected = value.turns[1]!
    const jev = remote({ ...value, turns: [value.turns[0]!, { ...selected, steps: selected.steps.map(step => ({ ...step, analysis: { status: 'unanalysed' } })) }] })
    render(view('session', jev))
    await screen.findByText('Request for turn 2')
    fireEvent.click(screen.getByRole('button', { name: 'Analyze this turn' }))
    await waitFor(() => { expect(jev.startStageAnalysis).toHaveBeenCalledWith({ sessionId: 'session', scope: { kind: 'turn', turn: 2 }, mode: 'missing' }) })
    expect(screen.getByText(/Analysis progress: 0 \/ 2/)).toBeTruthy()
    expect(screen.getByText(/Analysis progress: 0 \/ 2 · Analyzing/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel analysis' }))
    await waitFor(() => { expect(jev.cancelStageAnalysis).toHaveBeenCalledWith('batch-1') })
  })

  it('counts only currently classifiable targets for each mode', async () => {
    const value = snapshot()
    const selected = value.turns[1]!
    const failed = { ...selected.steps[0]!, analysis: { status: 'failed' as const } }
    const staleOversize = { ...selected.steps[1]!, classifiable: false, materialStatus: 'MATERIAL_TOO_LARGE' as const,
      analysis: { status: 'stale' as const, label: 'implementation' as const } }
    const jev = remote({ ...value, turns: [value.turns[0]!, { ...selected, steps: [failed, staleOversize] }] })
    render(view('session', jev))
    await screen.findByText('Request for turn 2')
    expect(screen.getByRole('button', { name: 'Analyze this turn' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Analyze unanalysed steps' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/Retryable in this turn: 1 steps/)).toBeTruthy()
    expect(screen.getByText(/Reanalysis in this turn: 1 steps/)).toBeTruthy()
    expect(screen.getByText(stageEn.materialTooLarge)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry failed steps' }))
    await waitFor(() => { expect(jev.startStageAnalysis).toHaveBeenCalledWith({ sessionId: 'session', scope: { kind: 'turn', turn: 2 }, mode: 'retry-failed' }) })
  })

  it('shows a failed refresh as failed while keeping the prior valid result inspectable', async () => {
    const value = snapshot()
    const selected = value.turns[1]!
    const failedRefresh = { ...selected.steps[0]!, analysis: {
      status: 'failed' as const, failure: { code: 'NETWORK', message: 'Could not reach Jev' },
      previousResult: { recordId: 'previous-1', label: 'review_validation' as const, stale: false, confidence: 0.45,
        probabilities: { review_validation: 0.45 }, model: 'jev-1.13.0', configuredModel: 'jev-latest' },
    } }
    const jev = remote({ ...value, turns: [value.turns[0]!, { ...selected, steps: [failedRefresh] }] })
    render(view('session', jev))
    expect(await screen.findByText(/Classification status: Failed/)).toBeTruthy()
    expect(screen.getByText('NETWORK')).toBeTruthy()
    expect(screen.getByText(/Previous saved result: Review and validation/)).toBeTruthy()
    expect(screen.getByText(/Confidence: 0.45/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Review and validation Step 1/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'View previous record' }))
    await waitFor(() => { expect(jev.getStageAnalysisRecord).toHaveBeenCalledWith('session', 'session-2:step-1', 'previous-1') })
  })

  it('ignores a late reply from the previous Session after a switch', async () => {
    let resolveOld: (value: StageNavigationSnapshot) => void = () => {}
    const oldReply = new Promise<StageNavigationSnapshot>(resolve => { resolveOld = resolve })
    const jev = remote()
    jev.getStageNavigation = vi.fn(async sessionId => sessionId === 'old' ? oldReply : { ...snapshot('new'), turns: [turn(9, [])] })
    const screenView = render(view('old', jev))
    screenView.rerender(view('new', jev))
    expect(await screen.findByText('Request for turn 9')).toBeTruthy()
    await act(async () => { resolveOld(snapshot('old')); await oldReply })
    expect(screen.queryByText('Request for turn 2')).toBeNull()
    expect(screen.getByRole('button', { name: /Turn 9 · Request for turn 9/ })).toBeTruthy()
  })

  it('keeps manual analysis state scoped to the Session when an earlier request finishes late', async () => {
    let rejectOld: (error: Error) => void = () => {}
    let resolveNew: (batch: NonNullable<StageNavigationSnapshot['batch']>) => void = () => {}
    const jev = remote()
    jev.getStageNavigation = vi.fn(async sessionId => {
      const value = snapshot(sessionId)
      return { ...value, turns: value.turns.map(item => ({ ...item, steps: item.steps.map(source => ({
        ...source, analysis: { status: 'unanalysed' as const },
      })) })) }
    })
    jev.startStageAnalysis = vi.fn(request => request.sessionId === 'old'
      ? new Promise((_, reject) => { rejectOld = reject })
      : new Promise(resolve => { resolveNew = resolve }))
    const screenView = render(view('old', jev))
    await screen.findByRole('button', { name: 'Analyze this turn' })
    fireEvent.click(screen.getByRole('button', { name: 'Analyze this turn' }))
    expect(jev.startStageAnalysis).toHaveBeenCalledWith({ sessionId: 'old', scope: { kind: 'turn', turn: 2 }, mode: 'missing' })

    screenView.rerender(view('new', jev))
    await waitFor(() => { expect(jev.getStageNavigation).toHaveBeenCalledWith('new', expect.any(AbortSignal)) })
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Analyze this turn' }).hasAttribute('disabled')).toBe(false) })
    fireEvent.click(screen.getByRole('button', { name: 'Analyze this turn' }))
    expect(jev.startStageAnalysis).toHaveBeenCalledWith({ sessionId: 'new', scope: { kind: 'turn', turn: 2 }, mode: 'missing' })

    await act(async () => { rejectOld(new Error('Old Session request failed')) })
    expect(screen.queryByText('Could not start analysis.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Analyze this turn' }).hasAttribute('disabled')).toBe(true)

    await act(async () => { resolveNew({ id: 'new-batch', sessionId: 'new', status: 'completed', total: 2, completed: 2, failed: 0, cancelled: 0 }) })
    expect(screen.getByRole('button', { name: 'Analyze this turn' }).hasAttribute('disabled')).toBe(false)
  })
})

describe('recorded stage connection identity', () => {
  it.each(['luna-openrouter', 'luna-openai'] as const)('shows the recorded %s channel, reported model and actual packets', async connectionId => {
    const focused = step(1, 1, 'implementation', 'Recorded Luna step')
    focused.analysis = { ...focused.analysis, connectionId, configuredModel: connectionId === 'luna-openai' ? 'gpt-6-luna' : 'openai/gpt-6-luna-decisions', model: 'actual-luna-model' }
    const jev = remote({ sessionId: 'session', cursor: 199, featureEnabled: true, turns: [turn(1, [focused])] })
    jev.getStageAnalysisRecord = vi.fn(async (_sessionId, stepId) => ({
      id: 'luna-stage', sessionId: 'session', stepId, revision: 1, sourceFingerprint: 'source-hash', ruleVersion: 'v1',
      status: 'succeeded', label: 'implementation', connectionId, model: 'actual-luna-model',
      connection: { connectionId, baseUrl: 'https://recorded.invalid/decisions', model: 'configured-luna', credentialRef: 'RECORDED_REF' },
      request: { state: { original: 'step' }, questions: [] }, rawResponse: { answers: [{ name: 'stage', type: 'choice', choice: 'implementation' }] },
      response: { answers: [{ id: 'stage', kind: 'choice', optionId: 'implementation' }] }, usageComplete: false,
      networkRecords: [{ id: 'stage-packet', questionIds: ['stage'], requestBody: { input: 'full recorded input' }, startedAt: '2026-10-07T00:00:00Z', status: 'succeeded', returnedModel: 'actual-luna-model', rawResponseText: '{"actual":"raw-provider-packet"}' }],
    }))
    render(view('session', jev))
    expect(await screen.findByText(`${stageEn.connection}: ${connectionId === 'luna-openai' ? stageEn.connectionLunaOpenAI : stageEn.connectionLunaOpenRouter}`)).toBeTruthy()
    expect(screen.getByText(`${stageEn.model}: actual-luna-model`)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: stageEn.details }))
    await screen.findByText(stageEn.providerRequests)
    expect(screen.getByText(stageEn.providerRequests).nextElementSibling?.textContent).toContain('raw-provider-packet')
    expect(screen.getByText(stageEn.parsedResponse).nextElementSibling?.textContent).toContain('"kind": "choice"')
    expect(screen.getByText(stageEn.usageIncomplete)).toBeTruthy()
    expect(jev.startStageAnalysis).not.toHaveBeenCalled()
  })

  it('does not invent a channel for old stage records', async () => {
    const jev = remote({ sessionId: 'session', cursor: 199, featureEnabled: true, turns: [turn(1, [step(1, 1, 'implementation', 'Old step')])] })
    render(view('session', jev))
    await screen.findByText('Old step')
    expect(screen.queryByText(`${stageEn.connection}: ${stageEn.connectionJev}`)).toBeNull()
    expect(screen.getByText(`${stageEn.model}: jev-1.13.0`)).toBeTruthy()
    expect(jev.startStageAnalysis).not.toHaveBeenCalled()
  })
})
