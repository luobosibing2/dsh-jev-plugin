import { describe, expect, it } from 'vitest'
import { knownUsage, parseProtocolResponse, parseWireResponse, protocolBody, validateRequest, wireBody } from '../src/wire.ts'
import type { JevRequest } from '../src/types.ts'
import { routerRequest } from './fixtures/decisions-request.ts'

const request: JevRequest = {
  state: {},
  questions: [
    { id: 'route', kind: 'choice', prompt: { task: 'choose' }, options: [
      { id: 'left', description: { path: ['left'] } }, { id: 'right', description: null },
    ] },
    { id: 'risk', kind: 'score', prompt: 'How much risk?', levels: ['low', { risk: 'medium' }, 'high'] },
    { id: 'ready', kind: 'noul', prompt: ['Is it ready?'], criteria: { true: 'ready', false: 'not ready' } },
  ],
}

const response = {
  answers: {
    route: { choice: 'left', probabilities: { left: 0.7, right: 0.3 }, confidence: 0.8 },
    risk: { score: 1.5, probabilities: { '0': 0.1, '1': 0.4, '2': 0.5 }, legend: ['low', 'medium', 'high'] },
    ready: { noul: 0.65 },
  },
  usage: { input_tokens: 42 },
}

describe('System One typed exchange', () => {
  it('keeps structured criteria and a fractional score in its original rubric', () => {
    const body = wireBody('jev-latest', request)
    expect(body).toMatchObject({ state: {}, questions: {
      route: { type: 'choice', instructions: { task: 'choose' }, criteria: { left: { path: ['left'] }, right: null } },
      risk: { type: 'score', criteria: ['low', { risk: 'medium' }, 'high'] },
      ready: { type: 'noul', criteria: { true: 'ready', false: 'not ready' } },
    } })
    const result = parseWireResponse(response, request)
    expect(result.response.answers).toEqual([
      { id: 'route', kind: 'choice', optionId: 'left', probabilities: { left: 0.7, right: 0.3 }, confidence: 0.8 },
      { id: 'risk', kind: 'score', value: 1.5, probabilities: { '0': 0.1, '1': 0.4, '2': 0.5 }, legend: ['low', 'medium', 'high'] },
      { id: 'ready', kind: 'noul', probability: 0.65 },
    ])
    expect(result.usage).toEqual({ inputTokens: 42 })
  })

  it('rejects incomplete, wrong-kind, unknown-option, and out-of-rubric responses', () => {
    expect(() => parseWireResponse({ answers: { route: response.answers.route } }, request)).toThrow()
    expect(() => parseWireResponse({ ...response, answers: { ...response.answers, risk: { type: 'noul', score: 1.5 } } }, request)).toThrow()
    expect(() => parseWireResponse({ ...response, answers: { ...response.answers, route: { choice: 'other' } } }, request)).toThrow()
    expect(() => parseWireResponse({ ...response, answers: { ...response.answers, risk: { score: 2.5 } } }, request)).toThrow()
    expect(() => parseWireResponse({ ...response, answers: { ...response.answers, route: { choice: 'left', probabilities: {} } } }, request)).toThrow()
  })

  it('refuses bad questions before transport', () => {
    expect(() => validateRequest({ state: {}, questions: [] })).toThrow()
    expect(() => validateRequest({ state: {}, questions: [{ id: 'bad', kind: 'choice', prompt: 'pick', options: [] }] })).toThrow()
    expect(() => validateRequest({ state: {}, questions: [{ id: 'bad', kind: 'score', prompt: 'rate', levels: ['only'] }] })).toThrow()
  })
})

describe('native Decisions exchange', () => {
  const native = { model: 'gpt-6-luna', provider_extension: { future: ['preserved', null] }, answers: [
    { name: 'ready', type: 'predicate', probability: 0.65 },
    { name: 'risk', type: 'score', score: 1.5, confidence: 0.9,
      probabilities: [{ value: 2, label: 'high', probability: 0.5 }, { value: 0, label: 'low', probability: 0.1 }, { value: 1, label: 'medium', probability: 0.4 }], legend: ['low', 'medium', 'high'] },
    { name: 'route', type: 'choice', choice: 'left', confidence: 0.8,
      probabilities: [{ value: 'right', probability: 0.3 }, { value: 'left', probability: 0.7 }] },
  ], usage: { input_tokens: 42, future_count: 99 } }

  it('encodes complete JSON and predicate conditions without moving empty score levels', () => {
    const input: JevRequest = { ...request, state: { ordered: [false, 12, null, { nested: 'exact original text' }] }, questions: [
      request.questions[0]!, { id: 'risk', kind: 'score', prompt: 'Rate', levels: [null, '', { depth: 3 }] }, request.questions[2]!,
    ] }
    expect(protocolBody('luna-openai', 'gpt-6-luna', input)).toEqual({ model: 'gpt-6-luna', input: JSON.stringify(input.state), questions: [
      { name: 'route', type: 'choice', instructions: JSON.stringify({ task: 'choose' }), choices: [{ value: 'left', description: JSON.stringify({ path: ['left'] }) }, { value: 'right' }] },
      { name: 'risk', type: 'score', instructions: 'Rate', levels: [{ label: '0' }, { label: '1' }, { label: '2', description: '{"depth":3}' }] },
      { name: 'ready', type: 'predicate', instructions: JSON.stringify({ instructions: ['Is it ready?'], criteria: { true: 'ready', false: 'not ready' } }) },
    ] })
    for (const state of [null, false, 17, 'original string'] as const) {
      expect(protocolBody('luna-openai', 'gpt-6-luna', { ...request, state })).toMatchObject({ input: typeof state === 'string' ? state : JSON.stringify(state) })
    }
    expect(protocolBody('luna-openrouter', 'openai/gpt-6-luna-decisions', input)).toMatchObject({ state: input.state, questions: { ready: { type: 'noul', instructions: ['Is it ready?'] } } })
  })

  it('decodes arrays by original identity and keeps raw optional extensions and partial usage', () => {
    const result = parseProtocolResponse(native, request, 'luna-openai')
    expect(result.response.answers).toEqual([
      { id: 'route', kind: 'choice', optionId: 'left', confidence: 0.8, probabilities: { left: 0.7, right: 0.3 } },
      { id: 'risk', kind: 'score', value: 1.5, confidence: 0.9, probabilities: { '0': 0.1, '1': 0.4, '2': 0.5 }, legend: ['low', 'medium', 'high'] },
      { id: 'ready', kind: 'noul', probability: 0.65 },
    ])
    expect(result.raw).toBe(native)
    expect(result.usage).toEqual({ inputTokens: 42 })
    expect(knownUsage({ usage: { input_tokens: 8, output_tokens: -1 } })).toEqual({ inputTokens: 8 })
    expect(parseProtocolResponse({ answers: [{ type: 'predicate', name: 'ready', probability: 0.8 }] }, { state: {}, questions: [request.questions[2]!] }, 'luna-openai').usage).toBeUndefined()
  })

  it('rejects refusal, mismatched identities, missing required fields and invalid probability arrays', () => {
    const replace = (answer: object) => ({ ...native, answers: [...native.answers.slice(0, 2), answer] })
    const choice = native.answers[2]!
    const bad = [
      { ...choice, type: 'refusal' }, { ...choice, name: 'other' }, { ...choice, type: 'predicate' },
      { ...choice, choice: false }, { ...choice, choice: 'other' }, { ...choice, confidence: undefined },
      { ...choice, probabilities: undefined }, { ...choice, confidence: Number.NaN },
      { ...choice, probabilities: [{ value: 'left', probability: 1 }] },
      { ...choice, probabilities: [{ value: 'left', probability: 0.7 }, { value: 'left', probability: 0.3 }] },
      { ...choice, probabilities: [{ value: 'left', probability: 0.7 }, { value: false, probability: 0.3 }] },
    ]
    for (const answer of bad) expect(() => parseProtocolResponse(replace(answer), request, 'luna-openai')).toThrow()
    expect(() => parseProtocolResponse({ ...native, answers: [native.answers[0], native.answers[0], choice] }, request, 'luna-openai')).toThrow()
    expect(() => parseProtocolResponse(replace({ name: 'route', type: 'refusal' }), request, 'luna-openai')).toThrowError(expect.objectContaining({ code: 'REFUSAL' }))
    expect(() => parseProtocolResponse(replace({ name: null, type: 'refusal' }), request, 'luna-openai')).toThrowError(expect.objectContaining({ code: 'REFUSAL' }))
  })

  it('keeps string choices distinct from booleans and score probabilities associated with their numeric indices', () => {
    const input: JevRequest = { state: {}, questions: [{ id: 'bool', kind: 'choice', prompt: 'Pick', options: [{ id: 'true', description: null }, { id: 'false', description: null }] }] }
    const answer = { type: 'choice', name: 'bool', choice: 'false', confidence: 0.8, probabilities: [{ value: 'true', probability: 0.2 }, { value: 'false', probability: 0.8 }] }
    expect(parseProtocolResponse({ answers: [answer] }, input, 'luna-openai').response.answers[0]).toMatchObject({ optionId: 'false' })
    expect(() => parseProtocolResponse({ answers: [{ ...answer, choice: false }] }, input, 'luna-openai')).toThrow()
    const score: JevRequest = { state: {}, questions: [request.questions[1]!] }
    expect(() => parseProtocolResponse({ answers: [{ ...native.answers[1], probabilities: [{ value: '0', probability: 1 }, { value: 1, probability: 0 }, { value: 2, probability: 0 }] }] }, score, 'luna-openai')).toThrow()
    expect(() => parseProtocolResponse({ answers: [{ ...native.answers[1], probabilities: [{ value: 0, probability: 1 }, { value: 1, label: '1', probability: 0 }, { value: 2, label: '2', probability: 0 }] }] }, score, 'luna-openai')).toThrow()
  })
})

it('uses accepted OpenRouter inputs for scalar state, missing score descriptions and partial truth conditions', () => {
  for (const state of [null, false, 3.5] as const) {
    for (const criteria of [{ true: 'ready' }, { true: null, false: ['original false condition'] }, {}]) {
      const input: JevRequest = { state, questions: [
        { id: 'route', kind: 'choice', prompt: { original: [null, false] }, options: [{ id: 'false', description: null }] },
        { id: 'risk', kind: 'score', prompt: 'Score', levels: [null, '', { original: [null, 'high'] }] },
        { id: 'ready', kind: 'noul', prompt: ['Original instructions'], criteria },
      ] }
      const rawJev = wireBody('custom-jev-model', input)
      expect(routerRequest.safeParse(rawJev).success).toBe(false)
      expect(rawJev).toMatchObject({ state, questions: { risk: { criteria: input.questions[1]!.kind === 'score' ? input.questions[1]!.levels : [] } } })
      const adapted = protocolBody('luna-openrouter', 'openai/gpt-6-luna-decisions', input)
      expect(routerRequest.safeParse(adapted).success).toBe(true)
      expect(adapted).toMatchObject({ state: JSON.stringify(state), questions: {
        risk: { criteria: ['', '', { original: [null, 'high'] }] },
        ready: { instructions: { instructions: ['Original instructions'], criteria } },
      } })
    }
  }
  expect(routerRequest.safeParse(protocolBody('luna-openrouter', 'openai/gpt-6-luna-decisions', request)).success).toBe(true)
})
