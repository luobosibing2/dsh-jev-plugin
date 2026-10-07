/** Generated Remote envelopes must be unwrapped before the page receives data. */

import { describe, expect, it, vi } from 'vitest'
import { RemoteError, type RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { jevPageRemote, jevStageRemote, type JevWireRemote } from '../src/client/remote-adapter.ts'
import type { StageNavigationSnapshot, StageBatchState, StageAnalysisRecord } from '../src/stage-types.ts'
import { resolveConnectionIdentity } from '../src/types.ts'
import { clientConfig } from './client-fixtures.ts'
import type {
  JevCredentialStatus, JevFeatureView, JevProbeResult, JevRecordDetail, JevRecordPage,
} from '../src/types.ts'

function ok<T>(value: T): RemoteResult<T> { return { ok: true, value } }
function failed<T>(error: RemoteError<'gateway/internal'>): RemoteResult<T> { return { ok: false, error } }

const features: JevFeatureView[] = [{ id: 'example', name: 'Example', description: 'Test', enabled: false }]
const page: JevRecordPage = { items: [], nextCursor: 'next' }
const detail: JevRecordDetail = {
  id: 'record', featureId: 'example', status: 'succeeded', diagnostic: false,
  startedAt: '2026-09-26T00:00:00.000Z', updatedAt: '2026-09-26T00:00:01.000Z',
  attempts: 1, link: {}, attemptRecords: [], receipts: [],
}
const connection = resolveConnectionIdentity(clientConfig({ judgmentModel: 'luna', lunaApi: 'openai' }))
const credential: JevCredentialStatus = { connection, configured: true, writable: false, source: 'environment' }
const probe: JevProbeResult = { connection, ok: true, latencyMs: 12, recordId: 'probe' }
const stageSnapshot: StageNavigationSnapshot = { sessionId: 'session-1', cursor: 0, featureEnabled: true, turns: [] }
const batch: StageBatchState = { id: 'batch-1', sessionId: 'session-1', status: 'completed', total: 0, completed: 0, failed: 0, cancelled: 0 }

function wire(): JevWireRemote {
  return {
    listFeatures: vi.fn(async () => ok(features)),
    listRecords: vi.fn(async () => ok(page)),
    getRecord: vi.fn(async () => ok(detail)),
    testConnection: vi.fn(async () => ok(probe)),
    getCredentialStatus: vi.fn(async () => ok(credential)),
    setCredential: vi.fn(async () => ok(credential)),
    getStageNavigation: vi.fn(async () => ok(stageSnapshot)),
    startStageAnalysis: vi.fn(async () => ok(batch)),
    cancelStageAnalysis: vi.fn(async () => ok(undefined)),
    getStageAnalysisRecord: vi.fn(async () => ok(null)),
  }
}

describe('Jev Remote page adapter', () => {
  it('passes each success value and preserves call arguments', async () => {
    const remote = wire()
    const adapted = jevPageRemote(remote)
    const filter = { featureId: 'example', limit: 25 }
    const signal = new AbortController().signal

    expect(await adapted.listFeatures()).toBe(features)
    expect(await adapted.listRecords(filter)).toBe(page)
    expect(await adapted.getRecord('record')).toBe(detail)
    expect(await adapted.testConnection(connection, signal)).toBe(probe)
    expect(await adapted.getCredentialStatus(connection)).toBe(credential)
    expect(await adapted.setCredential(connection, 'new-secret')).toBe(credential)
    expect(remote.listRecords).toHaveBeenCalledWith(filter)
    expect(remote.getRecord).toHaveBeenCalledWith('record')
    expect(remote.testConnection).toHaveBeenCalledWith(connection, signal)
    expect(remote.getCredentialStatus).toHaveBeenCalledWith(connection)
    expect(remote.setCredential).toHaveBeenCalledWith(connection, 'new-secret')
  })

  it('rejects every Remote failure branch before it reaches page data', async () => {
    const error = new RemoteError('gateway/internal', 'Unavailable', {})
    const remote: JevWireRemote = {
      listFeatures: async () => failed<JevFeatureView[]>(error),
      listRecords: async () => failed<JevRecordPage>(error),
      getRecord: async () => failed<JevRecordDetail | null>(error),
      testConnection: async () => failed<JevProbeResult>(error),
      getCredentialStatus: async () => failed<JevCredentialStatus>(error),
      setCredential: async () => failed<JevCredentialStatus>(error),
      getStageNavigation: async () => failed<StageNavigationSnapshot>(error),
      startStageAnalysis: async () => failed<StageBatchState>(error),
      cancelStageAnalysis: async () => failed<void>(error),
      getStageAnalysisRecord: async () => failed<StageAnalysisRecord | null>(error),
    }
    const adapted = jevPageRemote(remote)

    await expect(adapted.listFeatures()).rejects.toBe(error)
    await expect(adapted.listRecords({ limit: 25 })).rejects.toBe(error)
    await expect(adapted.getRecord('record')).rejects.toBe(error)
    await expect(adapted.testConnection(connection, new AbortController().signal)).rejects.toBe(error)
    await expect(adapted.getCredentialStatus(connection)).rejects.toBe(error)
    await expect(adapted.setCredential(connection, 'new-secret')).rejects.toBe(error)
    const stage = jevStageRemote(remote)
    await expect(stage.getStageNavigation('session-1', new AbortController().signal)).rejects.toBe(error)
    await expect(stage.startStageAnalysis({ sessionId: 'session-1', scope: { kind: 'all' }, mode: 'missing' })).rejects.toBe(error)
    await expect(stage.cancelStageAnalysis('batch-1')).rejects.toBe(error)
    await expect(stage.getStageAnalysisRecord('session-1', 'step-1')).rejects.toBe(error)
  })

  it('forwards Session stage scope and cancellation through typed envelopes', async () => {
    const remote = wire()
    const adapted = jevStageRemote(remote)
    const signal = new AbortController().signal
    const request = { sessionId: 'session-1', scope: { kind: 'turn' as const, turn: 8 }, mode: 'missing' as const }
    expect(await adapted.getStageNavigation('session-1', signal)).toBe(stageSnapshot)
    expect(await adapted.startStageAnalysis(request)).toBe(batch)
    expect(await adapted.cancelStageAnalysis('batch-1')).toBeUndefined()
    expect(await adapted.getStageAnalysisRecord('session-1', 'step-1')).toBeNull()
    expect(remote.getStageNavigation).toHaveBeenCalledWith('session-1', signal)
    expect(remote.startStageAnalysis).toHaveBeenCalledWith(request)
    expect(remote.cancelStageAnalysis).toHaveBeenCalledWith('batch-1')
    expect(remote.getStageAnalysisRecord).toHaveBeenCalledWith('session-1', 'step-1')
  })
})
