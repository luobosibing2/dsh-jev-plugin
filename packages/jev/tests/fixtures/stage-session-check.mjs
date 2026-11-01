/** Cold-read the synthetic stage session through DSH's installed persistence service. */
import assert from 'node:assert/strict'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const requiredHome = join(root, '.artifacts/stage-validation/home')
if (resolve(process.env.DSH_HOME ?? '') !== requiredHome) {
  throw new Error(`Set DSH_HOME=${requiredHome}; refusing to read another profile`)
}
const context = new Context()
await context.plugin(JsonlPersistence, { root: join(requiredHome, 'sessions') })
const sessionId = SessionId('stage-navigation-fixture-20260929')
const handle = await context.sessionPersistence.open(sessionId, 'read')
try {
  const { events } = await handle.read()
  const turns = events.filter(event => event.type === 'turn/end')
  const steps = events.filter(event => event.type === 'step/end')
  const first = events.find(event => event.type === 'assistant/message' && event.data.turn === 1 && event.data.step === 1)
  assert.ok(first)
  const reasoning = first.data.message.content.filter(block => block.type === 'reasoning')
  const calls = events.filter(event => event.type === 'tool/call' && event.data.turn === 1 && event.data.step === 1)
  const attempts = events.filter(event => event.type === 'assistant/attempt' && event.data.turn === 1 && event.data.step === 1)
  const final = events.find(event => event.type === 'assistant/message' && event.data.turn === 2 && event.data.step === 2)
  const failedTool = events.find(event => event.type === 'tool/result' && event.data.turn === 3)
  assert.equal(turns.length, 4)
  assert.equal(steps.length, 6)
  assert.equal(reasoning.length, 17)
  assert.equal(calls.length, 2)
  assert.equal(attempts.length, 1)
  assert.ok(final)
  assert.equal(final.data.message.content.some(block => block.type === 'tool-call'), false)
  assert.equal(failedTool?.data.message.isError, true)
  assert.deepEqual(turns[2].data.reason, { kind: 'aborted', reason: { kind: 'user' } })
  assert.equal(turns[3].data.reason.kind, 'error')
  process.stdout.write(JSON.stringify({ sessionId, eventCount: events.length,
    turns: turns.map(event => event.data.reason.kind), closedSteps: steps.length,
    firstStep: { reasoningBlocks: reasoning.length, toolCalls: calls.length, attempts: attempts.length },
    finalWithoutTool: true, abortedToolError: true }) + '\n')
} finally {
  await handle.close()
  await context.fiber.dispose()
}
