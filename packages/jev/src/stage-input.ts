/** Complete step requests with bounded, explicitly marked preceding context. */
import { createHash } from 'node:crypto'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JevRequest, Json } from './types.ts'
import type { StageStep, StageTurn } from './stage-types.ts'
import { redactCredentialText as redact, redactToolArguments } from './credential-redaction.ts'

export const STAGE_RULE_VERSION = 'whole-step-v1'
export const STAGE_REDACTION_VERSION = 'credential-patterns-v3'

const labels = [
  ['input_parsing', 'Identify initial task input and constraints'],
  ['problem_understanding', 'Establish facts, investigate causes, or resolve open questions'],
  ['solution_planning', 'Select or revise an approach against known requirements'],
  ['implementation', 'Make or debug changes, including local reads, tests, and rework'],
  ['review_validation', 'Assess whether an existing result meets requirements'],
  ['delivery_finalization', 'Organize evidence, update delivery records, or hand off known work'],
  ['mixed', 'Several primary purposes cannot be reduced to one'],
  ['unknown', 'The recorded evidence does not support a purpose judgment'],
] as const

export interface StageInputLimits { previousSteps: number; previousChars: number; maxRequestChars: number }
export type StageInputResult = { kind: 'ready'; request: JevRequest; fingerprint: string }
  | { kind: 'unavailable'; code: 'IN_PROGRESS' | 'NO_MATERIAL' | 'MATERIAL_TOO_LARGE'; fingerprint: string }

function visibleBlocks(blocks: readonly ContentBlock[], secrets: readonly string[]): Json[] {
  return blocks.map((block): Json => {
    switch (block.type) {
      case 'text':
      case 'reasoning':
        return { type: block.type, text: redact(block.text, secrets) }
      case 'tool-call':
        return { type: block.type, name: redact(block.name, secrets), arguments: redactToolArguments(block.arguments, secrets).text }
      case 'image':
        return { type: 'image', present: true, understoodByJev: false,
          mediaType: block.attachment.mediaType, bytes: block.attachment.bytes,
          width: block.attachment.width, height: block.attachment.height,
          ...block.attachment.name === undefined ? {} : { name: redact(block.attachment.name, secrets) } }
      case 'file':
        return { type: 'file', present: true, understoodByJev: false,
          name: redact(block.attachment.name, secrets), bytes: block.attachment.bytes }
      default:
        return { type: block.type, present: true, understoodByJev: false }
    }
  })
}

function hasRecordedMaterial(step: StageStep): boolean {
  return step.tools.length > 0 || step.messages.some(message => message.content.some(block => {
    if (block.type === 'text' || block.type === 'reasoning') return block.text.trim().length > 0
    return true
  }))
}

function predecessor(step: StageStep, chars: number, secrets: readonly string[]): Json {
  const text = step.assistant?.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
    || step.assistant?.content.filter(block => block.type === 'reasoning').map(block => block.text).join('\n') || ''
  const summary = redact(text, secrets)
  return {
    stepId: step.id, text: summary.slice(0, chars), truncated: summary.length > chars,
    tools: step.tools.map(tool => ({ name: redact(tool.name, secrets), result: tool.result === undefined ? 'missing' : tool.result.isError ? 'error' : 'recorded' })),
  }
}

/** Preserve the entire recorded target; an over-limit request is never shortened. */
export function buildStageInput(
  turns: readonly StageTurn[], target: StageStep, limits: StageInputLimits,
  connectionIdentity: string, secrets: readonly string[] = [],
): StageInputResult {
  const earlier = turns.flatMap(turn => turn.steps).filter(step => step.startSeq < target.startSeq)
  const previous = limits.previousSteps === 0 ? [] : earlier.slice(-limits.previousSteps).map(step => predecessor(step, limits.previousChars, secrets))
  const targetTurn = turns.find(turn => turn.turn === target.turn)
  const cutoff = target.assistant?.seq ?? target.endSeq ?? targetTurn?.endSeq ?? target.startSeq
  const currentRequests = targetTurn?.requests.filter(message => message.seq <= cutoff) ?? []
  const requests = (currentRequests.length > 0 ? currentRequests
    : turns.filter(turn => turn.startSeq < (targetTurn?.startSeq ?? target.startSeq)).findLast(turn => turn.requests.length > 0)?.requests ?? [])
    .map(message => ({ seq: message.seq, content: visibleBlocks(message.content, secrets) }))
  const assistant = target.messages.map(message => ({ seq: message.seq, interrupted: message.interrupted,
    content: visibleBlocks(message.content.filter(block => block.type !== 'tool-call'), secrets) }))
  const tools = target.tools.map(tool => ({
    seq: tool.seq, callId: tool.callId, name: redact(tool.name, secrets), arguments: redactToolArguments(tool.arguments, secrets).text,
    dispatched: tool.dispatched,
    result: tool.result === undefined ? null : {
      seq: tool.result.seq, isError: tool.result.isError,
      content: visibleBlocks(tool.result.content, secrets),
      ...tool.result.error === undefined ? {} : { error: {
        name: redact(tool.result.error.name, secrets), code: redact(tool.result.error.code, secrets),
        ...tool.result.error.reason === undefined ? {} : { reason: redact(tool.result.error.reason, secrets) },
      } },
    },
  }))
  const state: Json = {
    ruleVersion: STAGE_RULE_VERSION, redactionVersion: STAGE_REDACTION_VERSION,
    sessionId: target.id.slice(0, target.id.lastIndexOf(':')),
    target: { stepId: target.id, turn: target.turn, step: target.step, status: target.status,
      assistant, tools, modelRetryAttemptSeqs: target.attemptSeqs },
    effectiveUserRequests: requests,
    previousSteps: previous,
    previousContext: { available: earlier.length, included: previous.length, maxCharsPerStep: limits.previousChars },
    nonTextMaterial: 'Image and file content is represented only by presence markers; Jev cannot read that modality.',
  }
  const request: JevRequest = {
    state,
    questions: [{ id: 'stage', kind: 'choice',
      prompt: 'Choose the main purpose of this complete recorded agent step. Read the entire step and the user requests that were in force then. Tool names, file names, and one isolated phrase do not define a stage. Do not infer later outcomes, successful execution, missing reasoning, or unseen image/file contents. Choose mixed if several primary purposes are inseparable; unknown if evidence is insufficient. Return only the typed choice.',
      options: labels.map(([id, description]) => ({ id, description })),
    }],
  }
  const serialized = JSON.stringify(request)
  const fingerprint = createHash('sha256').update(JSON.stringify([STAGE_RULE_VERSION, STAGE_REDACTION_VERSION, connectionIdentity, serialized])).digest('hex')
  if (target.status === 'in-progress') return { kind: 'unavailable', code: 'IN_PROGRESS', fingerprint }
  if (!hasRecordedMaterial(target)) return { kind: 'unavailable', code: 'NO_MATERIAL', fingerprint }
  if (serialized.length > limits.maxRequestChars) return { kind: 'unavailable', code: 'MATERIAL_TOO_LARGE', fingerprint }
  return { kind: 'ready', request, fingerprint }
}
