import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { assembleStageHistory } from '../src/stage-history.ts'
import { buildStageInput, STAGE_REDACTION_VERSION } from '../src/stage-input.ts'

function event(seq: number, type: SessionEvent['type'], data: object): SessionEvent {
  return { seq, time: seq, type, data } as SessionEvent
}

const source = { kind: 'user' }
const user = (text: string) => ({ id: 'user-1', role: 'user', source, content: [{ type: 'text', text }] })
const assistant = (content: object[]) => ({ id: 'assistant-1', role: 'assistant', source: { kind: 'model' }, content })
const tool = (callId: string, text: string, isError = false) => ({ id: 'tool-' + callId, role: 'tool',
  source: { kind: 'tool', callId }, toolCallId: callId, isError, content: [{ type: 'text', text }] })

describe('complete historical step assembly and Jev input', () => {
  it('keeps seventeen reasoning blocks, final text, two paired tools, retry fact, and one target', () => {
    const content = [...Array.from({ length: 17 }, (_, index) => ({ type: 'reasoning', text: `Reason ${index}` })),
      { type: 'text', text: 'Working output' },
      { type: 'tool-call', id: 'one', name: 'read', arguments: '{"path":"a"}' },
      { type: 'tool-call', id: 'two', name: 'test', arguments: '{"command":"run"}' }]
    const events = [
      event(0, 'turn/start', { turn: 4 }),
      event(1, 'step/start', { turn: 4, step: 1 }),
      event(2, 'user/message', user('Implement and test')),
      event(3, 'assistant/attempt', { turn: 4, step: 1, stream: [] }),
      event(4, 'assistant/message', { turn: 4, step: 1, message: assistant(content), stream: [] }),
      event(5, 'tool/call', { turn: 4, step: 1, callId: 'one', name: 'read', arguments: '{"path":"a"}' }),
      event(6, 'tool/call', { turn: 4, step: 1, callId: 'two', name: 'test', arguments: '{"command":"run"}' }),
      event(7, 'tool/result', { turn: 4, step: 1, message: tool('one', 'source') }),
      event(8, 'tool/result', { turn: 4, step: 1, message: tool('two', 'failed', true) }),
      event(9, 'step/end', { turn: 4, step: 1 }),
      event(10, 'turn/end', { turn: 4, reason: { kind: 'aborted', reason: { kind: 'user' } } }),
    ]
    const turns = assembleStageHistory('session-a', events)
    expect(turns).toHaveLength(1)
    expect(turns[0]?.reason).toEqual({ kind: 'aborted', reason: { kind: 'user' } })
    const step = turns[0]?.steps[0]
    expect(step?.id).toBe('session-a:1')
    expect(step?.attemptSeqs).toEqual([3])
    expect(step?.assistant?.content.filter(block => block.type === 'reasoning')).toHaveLength(17)
    expect(step?.tools.map(call => [call.callId, call.dispatched, call.result?.isError])).toEqual([
      ['one', true, false], ['two', true, true],
    ])
    const input = buildStageInput(turns, step!, { previousSteps: 2, previousChars: 700, maxRequestChars: 48_000 }, 'connection')
    expect(input.kind).toBe('ready')
    if (input.kind !== 'ready') return
    const wire = JSON.stringify(input.request)
    expect(wire).toContain('Reason 16')
    expect(wire).toContain('"isError":true')
    expect(wire).toContain('"modelRetryAttemptSeqs":[3]')
    expect(input.request.questions[0]?.kind).toBe('choice')
    expect(input.request.questions).toHaveLength(1)
  })

  it('keeps undelivered model tool calls and marks ended partial steps without inventing a result', () => {
    const turns = assembleStageHistory('session-b', [
      event(10, 'turn/start', { turn: 2 }), event(11, 'step/start', { turn: 2, step: 1 }),
      event(12, 'user/message', user('Read the file')),
      event(13, 'assistant/message', { turn: 2, step: 1, message: assistant([
        { type: 'reasoning', text: 'Inspect first' },
        { type: 'tool-call', id: 'not-sent', name: 'read', arguments: '{"path":"a"}' },
      ]), stream: [], interrupted: true }),
      event(14, 'turn/end', { turn: 2, reason: { kind: 'aborted', reason: { kind: 'user' } } }),
    ])
    const step = turns[0]?.steps[0]
    expect(step?.status).toBe('terminal-partial')
    expect(step?.endSeq).toBeUndefined()
    expect(step?.tools).toEqual([{ seq: 13, callId: 'not-sent', name: 'read', arguments: '{"path":"a"}', dispatched: false }])
    const input = buildStageInput(turns, step!, { previousSteps: 2, previousChars: 700, maxRequestChars: 48_000 }, 'connection')
    expect(input.kind).toBe('ready')
    if (input.kind === 'ready') expect(JSON.stringify(input.request)).toContain('"result":null')
  })

  it('redacts quoted credentials, basic and bearer headers, URL secrets, and exact configured key before logging', () => {
    const secret = 'my-private-key-value'
    const turns = assembleStageHistory('session-c', [
      event(0, 'turn/start', { turn: 1 }), event(1, 'step/start', { turn: 1, step: 1 }),
      event(2, 'user/message', user('password="two word secret" Authorization: Basic Zm9vOmJhcg==')),
      event(3, 'assistant/message', { turn: 1, step: 1, message: assistant([
        { type: 'reasoning', text: `Bearer abcdefghi12345 ${secret}` },
        { type: 'text', text: 'https://user:pass@example.test/path?refresh_token=abc123#token=xyz987' },
      ]), stream: [] }),
      event(4, 'tool/call', { turn: 1, step: 1, callId: 'x', name: 'bash',
        arguments: '{"api_key":"quoted long key","nested":{"passwd":"three word pass"},"x":"apikey_1234567890123456"}' }),
      event(5, 'tool/result', { turn: 1, step: 1, message: tool('x', 'token=abc999 password: one two') }),
      event(6, 'step/end', { turn: 1, step: 1 }), event(7, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ])
    const input = buildStageInput(turns, turns[0]!.steps[0]!,
      { previousSteps: 2, previousChars: 700, maxRequestChars: 48_000 }, 'connection', [secret])
    expect(input.kind).toBe('ready')
    if (input.kind !== 'ready') return
    const wire = JSON.stringify(input.request)
    for (const leaked of ['two word secret', 'Zm9vOmJhcg==', secret, 'abcdefghi12345', 'user:pass',
      'abc123', 'xyz987', 'quoted long key', 'three word pass', 'one two', 'apikey_1234567890123456']) {
      expect(wire).not.toContain(leaked)
    }
    expect(wire).toContain(STAGE_REDACTION_VERSION)
  })

  it.each([
    { command: 'API_KEY="synthetic two word secret" npm run build', secrets: [], leaked: 'synthetic two word secret' },
    { command: 'echo configured\\dummy', secrets: ['configured\\dummy'], leaked: 'configured\\dummy' },
    { command: 'echo configured"dummy', secrets: ['configured"dummy'], leaked: 'configured"dummy' },
  ])('redacts decoded tool argument strings: $command', ({ command, secrets, leaked }) => {
    const argumentsText = JSON.stringify({ command, cwd: '/workspace', timeout: 1000, env: { api_key: 'nested dummy key' } })
    const turns = assembleStageHistory('session-json', [
      event(0, 'turn/start', { turn: 1 }), event(1, 'step/start', { turn: 1, step: 1 }),
      event(2, 'assistant/message', { turn: 1, step: 1, message: assistant([
        { type: 'tool-call', id: 'json-call', name: 'bash', arguments: argumentsText },
      ]), stream: [], interrupted: true }),
      event(3, 'turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } }),
    ])
    const original = JSON.stringify(turns)
    const input = buildStageInput(turns, turns[0]!.steps[0]!,
      { previousSteps: 0, previousChars: 700, maxRequestChars: 48_000 }, 'connection', secrets)
    expect(input.kind).toBe('ready')
    if (input.kind !== 'ready') return
    const state = input.request.state as { target: { tools: { arguments: string; dispatched: boolean }[] } }
    const args = JSON.parse(state.target.tools[0]!.arguments)
    expect(args.command).not.toContain(leaked)
    expect(args.command).toContain('[REDACTED]')
    expect(args).toMatchObject({ cwd: '/workspace', timeout: 1000, env: { api_key: '[REDACTED]' } })
    if (command.includes('npm run build')) expect(args.command).toContain('npm run build')
    expect(state.target.tools[0]!.dispatched).toBe(false)
    expect(JSON.stringify(turns)).toBe(original)
  })

  it('withholds incomplete tool arguments instead of sending undecodable credential text', () => {
    const argumentsText = '{"command":"API_KEY=\\"unfinished dummy secret'
    const turns = assembleStageHistory('session-incomplete', [
      event(0, 'turn/start', { turn: 1 }), event(1, 'step/start', { turn: 1, step: 1 }),
      event(2, 'assistant/message', { turn: 1, step: 1, message: assistant([
        { type: 'tool-call', id: 'partial', name: 'bash', arguments: argumentsText },
      ]), stream: [], interrupted: true }),
      event(3, 'turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } }),
    ])
    const input = buildStageInput(turns, turns[0]!.steps[0]!,
      { previousSteps: 0, previousChars: 700, maxRequestChars: 48_000 }, 'connection')
    expect(input.kind).toBe('ready')
    if (input.kind !== 'ready') return
    expect(JSON.stringify(input.request)).not.toContain('unfinished dummy secret')
    expect(JSON.stringify(input.request)).toContain('[REDACTED: invalid JSON tool arguments]')
    expect(turns[0]!.steps[0]!.tools[0]!.arguments).toBe(argumentsText)
  })

  it('bounds only previous context; a long target stays complete or is explicitly skipped', () => {
    const long = 'x'.repeat(2000)
    const turns = assembleStageHistory('session-d', [
      event(0, 'turn/start', { turn: 1 }), event(1, 'step/start', { turn: 1, step: 1 }),
      event(2, 'user/message', user('Do work')),
      event(3, 'assistant/message', { turn: 1, step: 1, message: assistant([{ type: 'text', text: long }]), stream: [] }),
      event(4, 'step/end', { turn: 1, step: 1 }),
      event(5, 'step/start', { turn: 1, step: 2 }),
      event(6, 'assistant/message', { turn: 1, step: 2, message: assistant([{ type: 'reasoning', text: long }]), stream: [] }),
      event(7, 'step/end', { turn: 1, step: 2 }), event(8, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ])
    const target = turns[0]!.steps[1]!
    const complete = buildStageInput(turns, target, { previousSteps: 1, previousChars: 50, maxRequestChars: 20_000 }, 'connection')
    expect(complete.kind).toBe('ready')
    if (complete.kind === 'ready') {
      const state = JSON.stringify(complete.request.state)
      expect(state).toContain(long)
      expect(state).toContain('"truncated":true')
    }
    const zero = buildStageInput(turns, target, { previousSteps: 0, previousChars: 50, maxRequestChars: 20_000 }, 'connection')
    if (zero.kind === 'ready') expect(JSON.stringify(zero.request.state)).toContain('"included":0')
    const oversized = buildStageInput(turns, target, { previousSteps: 1, previousChars: 50, maxRequestChars: 2048 }, 'connection')
    expect(oversized).toMatchObject({ kind: 'unavailable', code: 'MATERIAL_TOO_LARGE' })
  })

  it('does not classify an ended step whose recorded assistant content is empty or whitespace', () => {
    const turns = assembleStageHistory('session-empty', [
      event(0, 'turn/start', { turn: 1 }), event(1, 'step/start', { turn: 1, step: 1 }),
      event(2, 'assistant/message', { turn: 1, step: 1, message: assistant([
        { type: 'text', text: '  ' }, { type: 'reasoning', text: '\n' },
      ]), stream: [] }),
      event(3, 'step/end', { turn: 1, step: 1 }), event(4, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ])
    expect(buildStageInput(turns, turns[0]!.steps[0]!,
      { previousSteps: 2, previousChars: 700, maxRequestChars: 48_000 }, 'connection'))
      .toMatchObject({ kind: 'unavailable', code: 'NO_MATERIAL' })
  })
})
