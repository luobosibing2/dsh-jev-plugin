/** Complete recorded step material and auxiliary Jev stage analysis data. */
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { TurnEndReason } from '@deepseek-ai/dsh-session'
import type { JevAttemptRecord, JevConnectionId, JevRequest, JevResponse, Json } from './types.ts'

export interface StageNavigationConfigValues {
  previousSteps: number
  previousChars: number
  maxRequestChars: number
  concurrency: number
}

/** Jev's bounded purpose labels for one complete logical step. */
export type StageLabel = 'input_parsing' | 'problem_understanding' | 'solution_planning'
  | 'implementation' | 'review_validation' | 'delivery_finalization' | 'mixed' | 'unknown'

export interface StageMessage {
  seq: number
  content: readonly ContentBlock[]
}

export interface StageToolCall {
  callId: string
  name: string
  arguments: string
  seq: number
  dispatched: boolean
  result?: StageMessage & { isError: boolean; error?: { name: string; code: string; reason?: string } }
}

export type StageAnalysisStatus = 'unanalysed' | 'pending' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted' | 'stale' | 'unavailable'

export interface StagePreviousResult {
  recordId: string
  label: StageLabel
  stale: boolean
  confidence?: number
  probabilities?: Record<string, number>
  model?: string
  configuredModel?: string
  connectionId?: JevConnectionId
  updatedAt?: string
}

/** One step's latest persisted judgment; a stale judgment remains inspectable. */
export interface StageAnalysisSummary {
  status: StageAnalysisStatus
  label?: StageLabel
  confidence?: number
  probabilities?: Record<string, number>
  model?: string
  configuredModel?: string
  connectionId?: JevConnectionId
  recordId?: string
  operationId?: string
  failure?: { code: string; message: string }
  updatedAt?: string
  /** The preceding valid judgment stays inspectable while a newer attempt is pending or failed. */
  previousResult?: StagePreviousResult
}

/** Exact source and judgment evidence, fetched only when a step is inspected. */
export interface StageAnalysisRecord extends StageAnalysisSummary {
  id: string
  sessionId: string
  stepId: string
  revision: number
  sourceFingerprint: string
  ruleVersion: string
  request?: JevRequest
  response?: JevResponse
  rawResponse?: Json
  connection?: JevAttemptRecord['connection']
  networkRecords?: JevAttemptRecord['networkRecords']
  usage?: JevAttemptRecord['usage']
  usageComplete?: boolean
}

export interface StageStep {
  /** Session id plus durable `step/start` sequence, independent of visible row order. */
  id: string
  turn: number
  step: number
  startSeq: number
  endSeq?: number
  status: 'complete' | 'terminal-partial' | 'in-progress'
  classifiable: boolean
  materialStatus: 'ready' | 'IN_PROGRESS' | 'NO_MATERIAL' | 'MATERIAL_TOO_LARGE'
  assistant?: StageMessage & { interrupted: boolean }
  /** Every recorded final assistant message in this logical step, in event order. */
  messages: readonly (StageMessage & { interrupted: boolean })[]
  tools: readonly StageToolCall[]
  /** Failed or retried model attempts are recorded once, outside the final assistant message. */
  attemptSeqs: readonly number[]
  analysis: StageAnalysisSummary
}

export interface StageTurn {
  id: string
  turn: number
  startSeq: number
  endSeq?: number
  reason?: TurnEndReason
  requests: readonly StageMessage[]
  steps: readonly StageStep[]
}

export interface StageBatchState {
  id: string
  sessionId: string
  status: 'running' | 'completed' | 'cancelled' | 'failed'
  total: number
  completed: number
  failed: number
  cancelled: number
  failure?: { code: string; message: string }
}

/** A complete immutable Session history cut plus current auxiliary results. */
export interface StageNavigationSnapshot {
  sessionId: string
  cursor: number
  featureEnabled: boolean
  turns: readonly StageTurn[]
  batch?: StageBatchState
}

export interface StageAnalysisRequest {
  sessionId: string
  scope: { kind: 'turn'; turn: number } | { kind: 'all' }
  /** `missing` reuses valid results; `retry-failed` also revisits failed targets. */
  mode: 'missing' | 'retry-failed' | 'refresh'
}
