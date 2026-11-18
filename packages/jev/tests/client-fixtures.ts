/** Complete saved settings used by Client behavior fixtures. */
import type { JevConfigValues } from '../src/types.ts'

export function clientConfig(overrides: Partial<JevConfigValues> = {}): JevConfigValues {
  return {
    baseUrl: 'https://example.invalid', model: 'test-model', credentialRef: 'JEV_API_KEY', timeoutMs: 30000, features: {},
    judgmentModel: 'jev', lunaApi: 'openrouter', lunaOpenRouterBaseUrl: 'https://openrouter.ai/api/alpha/decisions',
    lunaOpenRouterCredentialRef: 'JEV_LUNA_OPENROUTER_API_KEY', lunaOpenAIBaseUrl: 'https://api.openai.com/v1/decisions',
    lunaOpenAICredentialRef: 'JEV_LUNA_OPENAI_API_KEY', ...overrides,
  }
}
