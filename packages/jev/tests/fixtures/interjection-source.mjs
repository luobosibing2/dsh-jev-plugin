/** Scripted main-model boundary for Jev routing against a built DSH profile. */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { LlmAdapter, LlmError, createUserMessage } from '@deepseek-ai/dsh-llm'

export const name = 'jev-interjection-source-fixture'
export const inject = ['llm', 'agents', 'jev']

/** @param {import('@deepseek-ai/cordis').Context} ctx - Disposable profile runtime. */
export function apply(ctx) {
  const route = process.env.JEV_INTERJECTION_SOURCE_ROUTE
  if (!['interrupt-steer', 'steer', 'follow-up'].includes(route)) throw new Error('Missing fixture route')
  const root = process.env.JEV_INTERJECTION_SOURCE_ROOT
  if (!root) throw new Error('Missing fixture output root')
  const correction = route === 'follow-up' ? 'After this task, inspect the plugin.'
    : route === 'steer' ? 'Include the plugin in the final comparison.'
      : 'Stop that approach and inspect the plugin instead.'
  const released = Promise.withResolvers()
  const observations = { route, correction, requests: [], firstRequestAborted: false, userMessages: [], turnEnds: [], phases: [] }
  let owner

  ctx.on('agent/pre-step', ({ agent }, next) => {
    owner ??= agent
    return next()
  })
  ctx.on('session/event', (session, event) => {
    if (owner?.session !== session) return
    if (event.type === 'turn/end') observations.turnEnds.push(event.data)
    if (event.type !== 'user/message') return
    const message = event.data
    if (message.source.kind === 'user') {
      observations.userMessages.push({ id: message.id, text: message.content
        .flatMap(block => block.type === 'text' ? [block.text] : []).join('') })
    }
    if (message.source.kind !== 'jev-interjection' || message.source.action !== 'route') return
    observations.phases.push(message.source.phase)
    if (route === 'steer' && message.source.phase === 'steer'
      || route === 'follow-up' && message.source.phase === 'queued') released.resolve()
  })

  class FixtureModel extends LlmAdapter {
    async * stream(request) {
      const entry = {
        messages: request.messages.map(message => ({ role: message.role,
          text: message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('') })),
        aborted: false,
      }
      const ordinal = observations.requests.push(entry)
      if (ordinal > 2) throw new Error('Unexpected extra main-model request')
      const markAborted = () => { entry.aborted = true }
      request.signal?.addEventListener('abort', markAborted, { once: true })
      try {
        if (ordinal === 1) {
          if (!owner || !request.signal) throw new Error('First response lacks the live Agent or cancellation signal')
          // Submit while the first response is active. No model chunk is yielded
          // before the real HTTP judge returns, so the interrupt case must abort
          // a stalled request rather than wait for a token barrier.
          owner.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: correction }] }))
          if (route === 'interrupt-steer') {
            await new Promise((resolve, reject) => {
              const abort = () => {
                observations.firstRequestAborted = true
                reject(new LlmError('Fixture response cancelled', 'ABORTED'))
              }
              if (request.signal.aborted) abort()
              else request.signal.addEventListener('abort', abort, { once: true })
            })
          } else {
            await new Promise((resolve, reject) => {
              const abort = () => { reject(new LlmError('Fixture response cancelled', 'ABORTED')) }
              if (request.signal.aborted) { abort(); return }
              request.signal.addEventListener('abort', abort, { once: true })
              void released.promise.then(() => {
                request.signal.removeEventListener('abort', abort)
                resolve()
              })
            })
            if (request.signal.aborted) throw new Error('Non-interrupt route aborted the first response')
          }
        }
        const value = ordinal === 1 ? 'ORIGINAL_RESPONSE' : 'CORRECTED_RESPONSE'
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: value } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      } finally {
        request.signal?.removeEventListener('abort', markAborted)
      }
    }
  }
  ctx.effect(() => ctx.llm.registerAdapter(['jev-interjection-source'], new FixtureModel()), 'fixture.main-model')
  ctx.effect(() => () => { released.resolve() })
  ctx.on('agent/turn-stopping', async ({ agent }) => {
    if (agent === owner) await writeFile(join(root, 'observations.json'), JSON.stringify(observations, null, 2) + '\n')
  })
  ctx.provide('jevInterjectionSourceReady', {})
}
