import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { JevAdapter, JEV_PROVIDER } from '../src/adapter.ts'
import type { JevRequest } from '../src/types.ts'

afterEach(() => { vi.restoreAllMocks() })

describe.each(['luna-openrouter', 'luna-openai'] as const)('Luna adapter Choice validation on %s', connectionId => {
  it.each([0, 1, 256])('does not dispatch a request with %i options', async count => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Invalid Choice reached HTTP transport'))
    const adapter = new JevAdapter()
    const request: JevRequest = { state: {}, questions: [{ id: 'pick', kind: 'choice', prompt: 'Pick',
      options: Array.from({ length: count }, (_, index) => ({ id: `candidate-${index}`, description: null })),
    }] }
    const model = connectionId === 'luna-openrouter' ? 'openai/gpt-6-luna-decisions' : 'gpt-6-luna'
    const issued = adapter.issue(request, { connectionId, model, baseUrl: 'http://127.0.0.1/invalid-choice',
      credentialRef: 'FIXTURE_KEY', apiKey: 'fixture-only', timeoutMs: 10_000 })
    const options: GenerateOptions = { provider: JEV_PROVIDER, model,
      messages: [{ role: 'user', content: [{ type: 'text', text: issued.envelope }] }] }
    try {
      await expect(adapter.stream(options)[Symbol.asyncIterator]().next()).rejects.toThrow()
      expect(fetch).not.toHaveBeenCalled()
      expect(issued.records).toEqual([])
    } finally { issued.release() }
  })
})
