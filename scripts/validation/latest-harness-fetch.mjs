/** Observe response metadata without persisting request headers, bodies, or credentials. */
import { appendFileSync } from 'node:fs'

const original = globalThis.fetch
let mainRequests = 0
globalThis.fetch = async function observedFetch(input, init) {
  const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const url = new URL(rawUrl)
  const endpoint = url.origin + url.pathname
  const selected = ['api.deepseek.com', 'api.typesafe.ai'].includes(url.hostname)
  const mainLimit = Number(process.env.JEV_VALIDATION_MAIN_REQUEST_LIMIT ?? 0)
  if (url.hostname === 'api.deepseek.com' && mainLimit > 0 && ++mainRequests > mainLimit) {
    throw new Error('Validation refused a provider request beyond the explicit main-request budget')
  }
  const started = Date.now()
  const response = await original(input, init)
  if (selected && process.env.JEV_VALIDATION_HTTP) {
    const clone = response.clone()
    void (async () => {
      let text = ''
      let observationError
      const reader = clone.body.getReader()
      const decoder = new TextDecoder()
      try {
        for (;;) {
          const chunk = await reader.read()
          if (chunk.done) break
          text += decoder.decode(chunk.value, { stream: true })
        }
      } catch (error) { observationError = error.name }
      finally { reader.releaseLock() }
      let returnedModel
      let usage
      for (const line of text.split('\n')) {
        const value = line.startsWith('data: ') ? line.slice(6) : line
        try {
          const packet = JSON.parse(value)
          returnedModel = packet.model ?? packet.message?.model ?? returnedModel
          usage = packet.usage ?? packet.message?.usage ?? usage
        } catch { /* SSE markers and non-JSON response text carry no model metadata. */ }
      }
      appendFileSync(process.env.JEV_VALIDATION_HTTP, JSON.stringify({ endpoint, status: response.status, returnedModel, usage, observationError, latencyMs: Date.now() - started, responseChars: text.length }) + '\n')
    })().catch(error => appendFileSync(process.env.JEV_VALIDATION_HTTP, JSON.stringify({ endpoint, status: response.status, observationError: error.name }) + '\n'))
  }
  return response
}
