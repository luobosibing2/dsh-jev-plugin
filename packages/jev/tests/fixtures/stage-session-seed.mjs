/** Seed an isolated DSH Web profile with synthetic, persisted Session history. */
import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import {
  AssistantStreamAccumulator,
  ToolCallId,
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const artifacts = join(root, '.artifacts/stage-validation')
const requiredHome = join(artifacts, 'home')
if (resolve(process.env.DSH_HOME ?? '') !== requiredHome) {
  throw new Error(`Set DSH_HOME=${requiredHome}; refusing to seed any other profile`)
}

const sessionId = SessionId('stage-navigation-fixture-20260929')
const workspace = join(artifacts, 'workspace')
await mkdir(workspace, { recursive: true })
const context = new Context()
await context.plugin(JsonlPersistence, { root: join(requiredHome, 'sessions') })
const existing = await context.sessionPersistence.stat(sessionId)
if (existing !== undefined) {
  process.stdout.write(JSON.stringify({ sessionId, existing: true, home: requiredHome }) + '\n')
  await context.fiber.dispose()
  process.exit(0)
}

const session = Session.create(sessionId, undefined, {
  version: SESSION_FORMAT_VERSION,
  id: sessionId,
  createdAt: Date.now(),
  cwd: workspace,
  isSeeded: false,
  agentPreset: 'standard',
})
let clock = Date.now()
function streamFor(content, finish) {
  const accumulator = new AssistantStreamAccumulator()
  content.forEach((block, index) => {
    accumulator.push({ time: ++clock, chunk: { type: 'block-start', index, blockType: block.type } })
    if (block.type === 'reasoning') {
      accumulator.push({ time: ++clock, chunk: { type: 'reasoning-delta', index, text: block.text } })
    } else if (block.type === 'text') {
      accumulator.push({ time: ++clock, chunk: { type: 'text-delta', index, text: block.text } })
    } else if (block.type === 'tool-call') {
      accumulator.push({ time: ++clock, chunk: {
        type: 'tool-call-delta', index, id: block.id, name: block.name, argumentsDelta: block.arguments,
      } })
    }
    accumulator.push({ time: ++clock, chunk: { type: 'block-end', index, block } })
  })
  accumulator.push({ time: ++clock, chunk: { type: 'finish', reason: { kind: finish } } })
  return accumulator.snapshot()
}

function startTurn(turn, prompt) {
  session.append('turn/start', { turn })
  session.append('step/start', { turn, step: 1 })
  session.append('user/message', createUserMessage({
    source: { kind: 'user' }, content: [{ type: 'text', text: prompt }],
  }), { surfaceOp: 'append' })
}

function assistant(turn, step, content, finish = 'stop') {
  session.append('assistant/message', {
    turn, step,
    message: createAssistantMessage({ source: { provider: 'stage-fixture', model: 'scripted-session' }, content }),
    stream: streamFor(content, finish),
  }, { surfaceOp: 'append' })
}

function tool(turn, step, suffix, result, isError = false) {
  const callId = ToolCallId(`stage-${turn}-${step}-${suffix}`)
  const name = 'stage_fixture_probe'
  const args = JSON.stringify({ marker: suffix })
  session.append('tool/call', { turn, step, callId, name, arguments: args })
  session.append('tool/result', {
    turn, step,
    message: createToolResultMessage({
      callId, content: [{ type: 'text', text: result }], isError,
    }),
    ...isError ? { error: { name: 'FixtureToolError', code: 'STAGE_FIXTURE_ERROR', reason: result } } : {},
  }, { surfaceOp: 'append' })
  return { type: 'tool-call', id: callId, name, arguments: args }
}

const reasoning = Array.from({ length: 17 }, (_, index) => ({
  type: 'reasoning', text: `STAGE_T1S1 Think ${String(index + 1).padStart(2, '0')}: inspect the fixture request and implementation evidence.`,
}))
const t1CallA = { type: 'tool-call', id: ToolCallId('stage-1-1-first'), name: 'stage_fixture_probe', arguments: '{"marker":"first"}' }
const t1CallB = { type: 'tool-call', id: ToolCallId('stage-1-1-second'), name: 'stage_fixture_probe', arguments: '{"marker":"second"}' }

startTurn(1, 'STAGE_FIXTURE_T1 Implement the example and test it. This fake credential must be redacted before Jev: sk-0123456789abcdefghijklmnopqrstuvwxyz.')
session.append('assistant/attempt', {
  turn: 1, step: 1,
  stream: [{ type: 'chunk', time: ++clock, chunk: { type: 'finish', reason: {
    kind: 'error', failure: { code: 'UNKNOWN', message: 'Synthetic first attempt failed before a visible message' },
  } } }],
})
assistant(1, 1, [...reasoning, { type: 'text', text: 'STAGE_T1S1 Calling two fixture probes.' }, t1CallA, t1CallB], 'tool-calls')
tool(1, 1, 'first', 'STAGE_T1S1 first probe passed')
tool(1, 1, 'second', 'STAGE_T1S1 second probe passed')
session.append('step/end', { turn: 1, step: 1 })
session.append('step/start', { turn: 1, step: 2 })
assistant(1, 2, [{ type: 'reasoning', text: 'STAGE_T1S2 Check the implementation output within the same request.' },
  { type: 'text', text: 'STAGE_T1S2 Implementation and local test completed in this synthetic fixture.' }])
session.append('step/end', { turn: 1, step: 2 })
session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

startTurn(2, 'STAGE_FIXTURE_T2 Independently review the completed artifact, then give a final answer.')
const t2Call = { type: 'tool-call', id: ToolCallId('stage-2-1-review'), name: 'stage_fixture_probe', arguments: '{"marker":"review"}' }
assistant(2, 1, [{ type: 'reasoning', text: 'STAGE_T2S1 Review the existing artifact against the acceptance checks.' },
  { type: 'text', text: 'STAGE_T2S1 Checking the existing result.' }, t2Call], 'tool-calls')
tool(2, 1, 'review', 'STAGE_T2S1 acceptance check passed')
session.append('step/end', { turn: 2, step: 1 })
session.append('step/start', { turn: 2, step: 2 })
assistant(2, 2, [{ type: 'text', text: 'STAGE_T2S2 Final reply without a tool call: synthetic delivery complete.' }])
session.append('step/end', { turn: 2, step: 2 })
session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })

startTurn(3, 'STAGE_FIXTURE_T3 This turn is deliberately cancelled after a failed fixture tool.')
const t3Call = { type: 'tool-call', id: ToolCallId('stage-3-1-aborted'), name: 'stage_fixture_probe', arguments: '{"marker":"aborted"}' }
assistant(3, 1, [{ type: 'reasoning', text: 'STAGE_T3S1 Investigate the failing fixture tool before cancellation.' },
  { type: 'text', text: 'STAGE_T3S1 Tool invocation has a recorded error.' }, t3Call], 'tool-calls')
tool(3, 1, 'aborted', 'STAGE_T3S1 fixture tool returned an error before user cancellation', true)
session.append('step/end', { turn: 3, step: 1 })
session.append('turn/end', { turn: 3, reason: { kind: 'aborted', reason: { kind: 'user' } } })

startTurn(4, 'STAGE_FIXTURE_T4 This turn records a model failure after a complete step.')
assistant(4, 1, [{ type: 'text', text: 'STAGE_T4S1 The fixture step is complete, then the turn fails.' }])
session.append('step/end', { turn: 4, step: 1 })
session.append('turn/end', { turn: 4, reason: { kind: 'error', error: {
  code: 'UNKNOWN', message: 'Synthetic fixture model failure after the recorded step',
} } })

const writer = await context.sessionPersistence.create(session.header)
try {
  await writer.append(session.snapshotEvents())
  await writer.flush()
} finally {
  await writer.close()
  await context.fiber.dispose()
}
process.stdout.write(JSON.stringify({
  sessionId, existing: false, home: requiredHome, turns: 4, steps: 6,
  eventCount: session.seq,
}) + '\n')
