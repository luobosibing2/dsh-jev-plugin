/** Jev common Host service and typed consumer API. */
import { Service, type Context, type Volatile } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type { Agent } from '@deepseek-ai/dsh-agent/types'
import type {} from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-user-questions'
import { JevAdapter, JEV_PROVIDER, type JevConnection } from './adapter.ts'
import { JevLedger } from './ledger.ts'
import { aggregateUsage, replayNetworkResponses, validateRequest } from './wire.ts'
import { resolveConnectionIdentity } from './types.ts'
import type { StageNavigationManager } from './stage-navigation.ts'
import type { StageAnalysisRecord, StageAnalysisRequest, StageBatchState, StageNavigationSnapshot } from './stage-types.ts'
import type {
  JevActionReceipt, JevCredentialStatus, JevFeatureDefinition, JevFeatureView,
  JevOperationLink, JevProbeResult, JevRecordDetail, JevRecordFilter, JevRecordPage,
  JevRequest, JevResponse, Json, JevConfigValues, JevConnectionId, JevConnectionIdentity, JevNetworkRecord,
} from './types.ts'

export type * from './types.ts'
export type * from './stage-types.ts'
export { JEV_PROVIDER } from './adapter.ts'

/** Current-profile configuration. Every field is editable through DSH configForms. */
export interface Config {
  baseUrl: Volatile<string>
  model: Volatile<string>
  credentialRef: Volatile<string>
  timeoutMs: Volatile<number>
  features: Volatile<Record<string, boolean>>
  judgmentModel: Volatile<'jev' | 'luna'>
  lunaApi: Volatile<'openrouter' | 'openai'>
  lunaOpenRouterBaseUrl: Volatile<string>
  lunaOpenRouterCredentialRef: Volatile<string>
  lunaOpenAIBaseUrl: Volatile<string>
  lunaOpenAICredentialRef: Volatile<string>
}

type ConfigValues = JevConfigValues

/** A consumer refreshes this input for every manual attempt. */
export interface JevJudgeOptions {
  featureId: string
  link: JevOperationLink
  agent: Agent
  refresh: (signal: AbortSignal) => JevRequest | Promise<JevRequest>
  interpret?: (response: JevResponse, signal: AbortSignal) => { usable: true } | { usable: false; reason: string } | Promise<{ usable: true } | { usable: false; reason: string }>
  canAdopt?: (response: JevResponse, signal: AbortSignal) => true | string | Promise<true | string>
  signal?: AbortSignal
}

/** Single-attempt consumers may read historical data without a running Agent. */
export type JevJudgeOnceOptions = Omit<JevJudgeOptions, 'agent'> & { agent?: Agent; connection?: JevConnectionIdentity }

/** A completed judgment is safe to consider only while `kind` is `ok`. */
export type JevJudgeResult =
  | { kind: 'ok'; operationId: string; attemptId: string; response: JevResponse }
  | { kind: 'cancelled'; operationId: string }
  | { kind: 'not-adopted'; operationId: string; reason: string }

/** Non-interactive attempts return failure without opening a human question. */
export type JevJudgeOnceResult = JevJudgeResult
  | { kind: 'failed'; operationId?: string; failure: { code: string; message: string } }

/** Stable failure code without provider payload or credential text. */
export class JevError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'JevError'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context { jev: JevService }
}

const PROBE: JevRequest = {
  state: { diagnostic: 'jev-connection-test' },
  questions: [
    { id: 'route', kind: 'choice', prompt: 'Choose the diagnostic option.', options: [
      { id: 'left', description: 'Diagnostic option left' }, { id: 'right', description: 'Diagnostic option right' },
    ] },
    { id: 'risk', kind: 'score', prompt: 'Score this fixed diagnostic on the supplied levels.', levels: ['low', 'medium', 'high'] },
    { id: 'ready', kind: 'noul', prompt: 'Is this a fixed connection diagnostic?' },
  ],
}

/** Validated live configuration presented through DSH settings. */
export const Config: s<ConfigValues, Config> = s.object({
  baseUrl: s.string().pattern(/^(?:$|https?:\/\/(?:\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+)(?::[0-9]{1,5})?(?:\/[^?#\s]*)?)$/).default('').volatile(),
  model: s.string().pattern(/^[^\s]+$/).default('jev-latest').volatile(),
  credentialRef: s.string().pattern(/^[A-Za-z_][A-Za-z0-9_]*$/).default('JEV_API_KEY').volatile(),
  timeoutMs: s.number().step(1).min(1).max(300_000).default(10_000).volatile(),
  features: s.dict(s.boolean()).default({}).volatile(),
  judgmentModel: s.union(['jev', 'luna']).default('jev').volatile(),
  lunaApi: s.union(['openrouter', 'openai']).default('openrouter').volatile(),
  lunaOpenRouterBaseUrl: s.string().pattern(/^(?:$|https?:\/\/(?:\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+)(?::[0-9]{1,5})?(?:\/[^?#\s]*)?)$/).default('https://openrouter.ai/api/alpha/decisions').volatile(),
  lunaOpenRouterCredentialRef: s.string().pattern(/^[A-Za-z_][A-Za-z0-9_]*$/).default('JEV_LUNA_OPENROUTER_API_KEY').volatile(),
  lunaOpenAIBaseUrl: s.string().pattern(/^(?:$|https?:\/\/(?:\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+)(?::[0-9]{1,5})?(?:\/[^?#\s]*)?)$/).default('https://api.openai.com/v1/decisions').volatile(),
  lunaOpenAICredentialRef: s.string().pattern(/^[A-Za-z_][A-Za-z0-9_]*$/).default('JEV_LUNA_OPENAI_API_KEY').volatile(),
})

function safeFailure(error: unknown): { code: string; message: string } {
  if (error instanceof JevError) return { code: error.code, message: error.message }
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    const code = error.code
    if (['AUTH', 'PAYMENT_REQUIRED', 'RATE_LIMIT', 'SERVER', 'BAD_REQUEST', 'NETWORK', 'ABORTED', 'TIMEOUT', 'REFUSAL', 'INVALID_RESPONSE', 'FEATURE_DISABLED'].includes(code)) {
      return { code, message: `Jev ${code.toLowerCase().replaceAll('_', ' ')}` }
    }
  }
  return { code: 'SERVICE_FAILURE', message: 'Jev request failed' }
}

/** One profile's public judgment service and browser Remote namespace. */
export class JevService extends TypertRemoteService {
  static inject = ['llm', 'credentials', 'storageDomain', 'userQuestions', 'profileContext', 'settings']
  static Config = Config

  private readonly adapter = new JevAdapter()
  private readonly features = new Map<string, JevFeatureDefinition>()
  private ledger?: JevLedger
  private readonly active = new Set<Promise<unknown>>()
  private readonly controllers = new Set<AbortController>()
  private disposing = false
  private readonly featureListeners = new Set<(features: Readonly<Record<string, boolean>>) => void>()
  private stageNavigation?: StageNavigationManager

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'jev')
  }

  protected async [Service.init](): Promise<void> {
    this.ledger = await JevLedger.open(this.ctx.storageDomain, this.ctx.profileContext.dir)
    this.ctx.effect(() => async () => {
      this.disposing = true
      for (const controller of this.controllers) controller.abort()
      await Promise.allSettled([...this.active])
      await this.ledger?.close()
    }, 'jev.ledger')
    this.ctx.effect(() => this.ctx.llm.registerAdapter([JEV_PROVIDER], this.adapter), 'jev.adapter')
    this.ctx.effect(() => this.ctx.settings.configure({ auto: false }, this.ctx.fiber), 'jev.settings')
    let features = JSON.stringify(this.config.features.get())
    this.ctx.on('loader/volatile-update', () => {
      const next = this.config.features.get()
      const identity = JSON.stringify(next)
      if (identity === features) return
      features = identity
      const snapshot = Object.freeze({ ...next })
      for (const listener of this.featureListeners) listener(snapshot)
    })
  }

  private records(): JevLedger {
    if (this.ledger === undefined) throw new JevError('UNAVAILABLE', 'Jev service is unavailable')
    return this.ledger
  }

  /** Register a consumer feature for this Host lifetime; the caller owns the disposer. */
  registerFeature(feature: JevFeatureDefinition): () => void {
    if (!/^[a-z][a-z0-9-]*$/.test(feature.id) || !feature.name.trim() || !feature.description.trim()) {
      throw new JevError('INVALID_FEATURE', 'Jev feature identity and description are required')
    }
    if (this.features.has(feature.id)) throw new JevError('DUPLICATE_FEATURE', `Jev feature ${feature.id} is already registered`)
    this.features.set(feature.id, feature)
    return () => { if (this.features.get(feature.id) === feature) this.features.delete(feature.id) }
  }

  /** Current registrations, with unknown and newly registered ids disabled by default. */
  @Remote('listFeatures')
  async listFeatures(): Promise<JevFeatureView[]> {
    const enabled = this.config.features.get()
    return [...this.features.values()].map(feature => ({ ...feature, enabled: enabled[feature.id] === true }))
  }

  /** Query only the current profile, with bounded page size and optional filters. */
  @Remote('listRecords')
  async listRecords(filter: JevRecordFilter): Promise<JevRecordPage> {
    if (filter.limit !== undefined && (!Number.isSafeInteger(filter.limit) || filter.limit < 1 || filter.limit > 100)) {
      throw new JevError('INVALID_FILTER', 'Jev record limit must be between 1 and 100')
    }
    return this.records().list(filter)
  }

  /** Read one current-profile operation after the list has identified it. */
  @Remote('getRecord')
  async getRecord(id: string): Promise<JevRecordDetail | null> { return this.records().get(id) }

  /** Bind the optional Host stage consumer while its plugin row is active. */
  registerStageNavigation(manager: StageNavigationManager): () => void {
    if (this.stageNavigation !== undefined) throw new JevError('DUPLICATE_FEATURE', 'Stage navigation is already registered')
    this.stageNavigation = manager
    return () => { if (this.stageNavigation === manager) this.stageNavigation = undefined }
  }

  private stages(): StageNavigationManager {
    if (this.stageNavigation === undefined) throw new JevError('UNAVAILABLE', 'Stage navigation is unavailable')
    return this.stageNavigation
  }

  /** Read one complete authorized Session cut and its auxiliary stage results. */
  @Remote('getStageNavigation')
  getStageNavigation(sessionId: string, signal: AbortSignal): Promise<StageNavigationSnapshot> {
    return this.stages().read(sessionId, signal)
  }

  /** Start only a user-requested batch; returning does not await model calls. */
  @Remote('startStageAnalysis')
  startStageAnalysis(request: StageAnalysisRequest): Promise<StageBatchState> {
    return this.stages().start(request)
  }

  /** Cancel auxiliary requests without cancelling the native Agent. */
  @Remote('cancelStageAnalysis')
  cancelStageAnalysis(batchId: string): Promise<void> { return this.stages().cancel(batchId) }

  /** Load exact persisted input and raw Jev answer for one selected step. */
  @Remote('getStageAnalysisRecord')
  getStageAnalysisRecord(sessionId: string, stepId: string, recordId?: string): Promise<StageAnalysisRecord | null> {
    return this.stages().detail(sessionId, stepId, recordId)
  }

  /** Report credential presence, source, and writability without its value. */
  @Remote('getCredentialStatus')
  async getCredentialStatus(connection: JevConnectionIdentity): Promise<JevCredentialStatus> {
    const identity = this.savedConnection(connection)
    const info = await this.ctx.credentials.describe(credentialRef(identity.credentialRef))
    return { connection: identity, configured: info.configured, writable: info.writable, ...info.source === undefined ? {} : { source: info.source } }
  }

  /** Save or replace the current profile's configured credential reference. */
  @Remote('setCredential')
  async setCredential(connection: JevConnectionIdentity, value: string): Promise<JevCredentialStatus> {
    if (value.trim().length === 0) throw new JevError('INVALID_CREDENTIAL', 'Jev key must not be blank')
    const identity = this.savedConnection(connection)
    await this.ctx.credentials.set(credentialRef(identity.credentialRef), value.trim())
    const info = await this.ctx.credentials.describe(credentialRef(identity.credentialRef))
    return { connection: identity, configured: info.configured, writable: info.writable, ...info.source === undefined ? {} : { source: info.source } }
  }

  /** Run one fixed diagnostic without a business feature or user state. */
  @Remote('testConnection')
  async testConnection(connection: JevConnectionIdentity, signal: AbortSignal): Promise<JevProbeResult> {
    const identity = this.savedConnection(connection, true)
    return this.runActive(signal, async lifetime => {
      const started = Date.now()
      const operation = await this.records().create('diagnostic', {}, true)
      try {
        const result = await this.tryOnce(operation.id, PROBE, undefined, lifetime, undefined, identity)
        if (lifetime.aborted) await this.records().setStatus(operation.id, 'cancelled')
        return {
          ok: result.ok,
          latencyMs: Date.now() - started,
          recordId: operation.id,
          connection: identity,
          ...result.ok ? {} : { failure: result.failure },
        }
      } catch (error) {
        if (!(error instanceof JevError && error.code === 'LOG_WRITE_FAILED')) {
          await this.records().setStatus(operation.id, lifetime.aborted ? 'cancelled' : 'failed')
        }
        throw error
      }
    })
  }

  /** Judge one dependent operation; only a human retry invokes `refresh` again. */
  judge(options: JevJudgeOptions): Promise<JevJudgeResult> {
    return this.runActive(options.signal, lifetime => this.judgeOwned(options, lifetime))
  }

  /** Make one logged attempt without human waiting or automatic retry. Only `ok` permits adoption. */
  judgeOnce(options: JevJudgeOnceOptions): Promise<JevJudgeOnceResult> {
    return this.runActive<JevJudgeOnceResult>(options.signal, async lifetime => {
      let operationId: string | undefined
      try {
        if (!this.features.has(options.featureId)) throw new JevError('UNKNOWN_FEATURE', 'Jev feature is not registered')
        if (!this.isEnabled(options.featureId)) throw new JevError('FEATURE_DISABLED', 'Jev feature is disabled')
        const operation = await this.records().create(options.featureId, options.link)
        operationId = operation.id
        if (lifetime.aborted) return this.cancel(operation.id)
        const request = await this.untilAbort(Promise.resolve(options.refresh(lifetime)), lifetime)
        validateRequest(request)
        const attempted = await this.tryOnce(operation.id, request, options.interpret, lifetime, options.featureId, options.connection)
        if (lifetime.aborted) return this.cancel(operation.id)
        if (!attempted.ok) return { kind: 'failed', operationId, failure: attempted.failure }
        const current = options.canAdopt === undefined ? true
          : await this.untilAbort(Promise.resolve(options.canAdopt(attempted.response, lifetime)), lifetime)
        if (lifetime.aborted) return this.cancel(operation.id)
        if (current !== true) {
          const reason = current || 'Target is no longer current'
          await this.writeReceipt(operation.id, { id: 'not-adopted', status: 'not-adopted', reason, at: new Date().toISOString() })
          return { kind: 'not-adopted', operationId, reason }
        }
        return { kind: 'ok', operationId, attemptId: attempted.attemptId, response: attempted.response }
      } catch (error) {
        const code = error instanceof JevError && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code) ? error.code : 'SERVICE_FAILURE'
        const failure = { code, message: 'Jev ' + code.toLowerCase().replaceAll('_', ' ') }
        if (operationId !== undefined) {
          try {
            if (lifetime.aborted) await this.records().setStatus(operationId, 'cancelled')
            else await this.records().failOperation(operationId, failure)
          }
          catch { /* A failed ledger remains unconfirmed; this background path never blocks the Agent. */ }
        }
        if (lifetime.aborted && operationId !== undefined) return { kind: 'cancelled', operationId }
        return { kind: 'failed', ...operationId === undefined ? {} : { operationId }, failure }
      }
    }).catch(error => ({ kind: 'failed', failure: safeFailure(error) }))
  }

  private runActive<T>(outer: AbortSignal | undefined, execute: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.disposing) return Promise.reject(new JevError('UNAVAILABLE', 'Jev service is stopping'))
    const controller = new AbortController()
    this.controllers.add(controller)
    const signal = outer === undefined ? controller.signal : AbortSignal.any([controller.signal, outer])
    const task = execute(signal).finally(() => {
      this.controllers.delete(controller)
      this.active.delete(task)
    })
    this.active.add(task)
    return task
  }

  private async untilAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) throw new JevError('CANCELLED', 'Jev operation was cancelled')
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => { signal.removeEventListener('abort', onAbort); reject(new JevError('CANCELLED', 'Jev operation was cancelled')) }
      signal.addEventListener('abort', onAbort, { once: true })
      void work.then(value => { signal.removeEventListener('abort', onAbort); resolve(value) }, error => {
        signal.removeEventListener('abort', onAbort); reject(error)
      })
    })
  }

  private async judgeOwned(options: JevJudgeOptions, lifetime: AbortSignal): Promise<JevJudgeResult> {
    if (!this.features.has(options.featureId)) throw new JevError('UNKNOWN_FEATURE', 'Jev feature is not registered')
    if (!this.isEnabled(options.featureId)) throw new JevError('FEATURE_DISABLED', 'Jev feature is disabled')
    if (this.disposing) throw new JevError('UNAVAILABLE', 'Jev service is stopping')
    const operation = await this.records().create(options.featureId, options.link)
    try {
      for (;;) {
      if (lifetime.aborted) return this.cancel(operation.id)
      if (!this.isEnabled(options.featureId)) {
        const choice = await this.ask(options.agent, lifetime, 'Jev feature is disabled. Enable it to retry or cancel.')
        if (choice === 'cancel') return this.cancel(operation.id)
        continue
      }
      const request = await this.untilAbort(Promise.resolve(options.refresh(lifetime)), lifetime)
      validateRequest(request)
      const attempted = await this.tryOnce(operation.id, request, options.interpret, lifetime, options.featureId)
      if (lifetime.aborted) return this.cancel(operation.id)
      if (attempted.ok) {
        if (options.canAdopt !== undefined) {
          const current = await this.untilAbort(Promise.resolve(options.canAdopt(attempted.response, lifetime)), lifetime)
          if (lifetime.aborted) return this.cancel(operation.id)
          if (current !== true) {
            const reason = current || 'Target is no longer current'
            await this.writeReceipt(operation.id, { id: 'not-adopted', status: 'not-adopted', reason, at: new Date().toISOString() })
            return { kind: 'not-adopted', operationId: operation.id, reason }
          }
        }
        return { kind: 'ok', operationId: operation.id, attemptId: attempted.attemptId, response: attempted.response }
      }
      await this.records().setStatus(operation.id, 'waiting')
      const choice = await this.ask(options.agent, lifetime, `${attempted.failure.message}. Retry with current input or cancel?`)
      if (choice === 'cancel') return this.cancel(operation.id)
      }
    } catch (error) {
      if (!(error instanceof JevError && (error.code === 'LOG_WRITE_FAILED' || error.code === 'RECEIPT_NOT_SAVED'))) {
        await this.records().setStatus(operation.id, lifetime.aborted ? 'cancelled' : 'failed')
      }
      if (lifetime.aborted) return { kind: 'cancelled', operationId: operation.id }
      throw error
    }
  }

  private async cancel(operationId: string): Promise<JevJudgeResult> {
    await this.records().setStatus(operationId, 'cancelled')
    return { kind: 'cancelled', operationId }
  }

  private isEnabled(id: string): boolean { return this.isFeatureEnabled(id) }

  /** Read this profile's current enablement synchronously; absent feature ids are disabled. */
  isFeatureEnabled(featureId: string): boolean { return this.config.features.get()[featureId] === true }

  /** Observe committed feature-setting changes synchronously; the consumer owns the disposer. */
  onFeatureStateChange(listener: (features: Readonly<Record<string, boolean>>) => void): () => void {
    this.featureListeners.add(listener)
    return () => { this.featureListeners.delete(listener) }
  }

  private async ask(agent: Agent, signal: AbortSignal, detail: string): Promise<'retry' | 'cancel'> {
    try {
      const answer = await this.untilAbort(this.ctx.userQuestions.ask({
        agent, signal,
        questions: [{ id: 'jev-resolution', question: 'Jev 判断需要您的决定 / Jev judgment needs your decision',
          detail: `${detail}\n失败后不会自动继续。请选择重试或取消。 / Jev will not continue automatically. Choose retry or cancel.`,
          options: [{ label: '重试 / Retry' }, { label: '取消 / Cancel' }] }],
      }), signal)
      const choice = answer.answers.find(item => item.id === 'jev-resolution')
      if (choice?.selected.length !== 1 || (choice.custom ?? '').trim() !== '') {
        throw new JevError('INVALID_HUMAN_ANSWER', 'Jev needs an explicit Retry or Cancel selection')
      }
      const [selected] = choice.selected
      if (selected === '重试 / Retry' || selected === '重试' || selected === 'Retry') return 'retry'
      if (selected === '取消 / Cancel' || selected === '取消' || selected === 'Cancel') return 'cancel'
      throw new JevError('INVALID_HUMAN_ANSWER', 'Jev needs an explicit Retry or Cancel selection')
    } catch (error) {
      if (signal.aborted) throw new JevError('CANCELLED', 'Jev operation was cancelled')
      if (error instanceof JevError) throw error
      throw new JevError('NO_INTERFACE', 'Jev requires an available Web question interface to continue')
    }
  }

  private configValues(): JevConfigValues {
    return { baseUrl: this.config.baseUrl.get(), model: this.config.model.get(), credentialRef: this.config.credentialRef.get(),
      timeoutMs: this.config.timeoutMs.get(), features: this.config.features.get(),
      judgmentModel: this.config.judgmentModel.get(), lunaApi: this.config.lunaApi.get(),
      lunaOpenRouterBaseUrl: this.config.lunaOpenRouterBaseUrl.get(), lunaOpenRouterCredentialRef: this.config.lunaOpenRouterCredentialRef.get(),
      lunaOpenAIBaseUrl: this.config.lunaOpenAIBaseUrl.get(), lunaOpenAICredentialRef: this.config.lunaOpenAICredentialRef.get() }
  }

  private connectionIdentity(id?: JevConnectionId): JevConnectionIdentity {
    return resolveConnectionIdentity(this.configValues(), id)
  }

  private savedConnection(expected: JevConnectionIdentity, active = false): JevConnectionIdentity {
    if (!['jev', 'luna-openrouter', 'luna-openai'].includes(expected.connectionId)) throw new JevError('CONNECTION_CHANGED', 'Refresh the saved judgment connection')
    const identity = this.connectionIdentity(active ? undefined : expected.connectionId)
    if (expected.connectionId !== identity.connectionId || expected.baseUrl !== identity.baseUrl || expected.model !== identity.model
      || expected.credentialRef !== identity.credentialRef || expected.timeoutMs !== identity.timeoutMs) {
      throw new JevError('CONNECTION_CHANGED', 'The saved judgment connection changed; refresh before continuing')
    }
    return identity
  }

  /** Stable non-secret connection settings used to decide whether an old stage result is current. */
  stageConnectionIdentity(): Omit<JevConnectionIdentity, 'connectionId'> & { connectionId?: JevConnectionId } {
    const { connectionId, ...legacy } = this.connectionIdentity()
    // Retain existing Jev fingerprint bytes; Luna includes its explicit protocol identity.
    return connectionId === 'jev' ? legacy : { ...legacy, connectionId }
  }

  /** All saved references must be checked before historical input is released to a provider. */
  stageConnections(): readonly JevConnectionIdentity[] {
    return (['jev', 'luna-openrouter', 'luna-openai'] as const).map(id => this.connectionIdentity(id))
  }

  /** Current saved connection without authentication values. */
  judgmentConnectionIdentity(): JevConnectionIdentity {
    return this.connectionIdentity()
  }

  private async tryOnce(
    operationId: string, request: JevRequest,
    interpret?: JevJudgeOptions['interpret'], outerSignal?: AbortSignal, featureId?: string, expectedConnection?: JevConnectionIdentity,
  ): Promise<{ ok: true; attemptId: string; response: JevResponse } | { ok: false; failure: { code: string; message: string } }> {
    let snapshot: JevRequest
    try {
      snapshot = JSON.parse(JSON.stringify(request)) as JevRequest
      validateRequest(snapshot)
    } catch {
      throw new JevError('INVALID_INPUT', 'Jev request must contain valid JSON state and questions')
    }
    const identity = expectedConnection === undefined ? this.connectionIdentity() : this.savedConnection(expectedConnection, true)
    const attempt = await this.records().startAttempt(operationId, snapshot, {
      baseUrl: identity.baseUrl, model: identity.model, credentialRef: identity.credentialRef, connectionId: identity.connectionId,
    }).catch(() => { throw new JevError('LOG_WRITE_FAILED', 'Jev input could not be saved; no request was sent') })
    let rawResponse: Json | undefined
    let response: JevResponse | undefined
    let networkRecords: readonly JevNetworkRecord[] = []
    let usage: { inputTokens?: number; outputTokens?: number } | undefined
    let usageComplete = false
    const timeout = AbortSignal.timeout(identity.timeoutMs)
    const signal = AbortSignal.any([timeout, ...outerSignal === undefined ? [] : [outerSignal]])
    try {
      if (!identity.baseUrl || !identity.model || !identity.credentialRef) {
        throw new JevError('CONNECTION_MISSING', 'Jev service address, model, or credential reference is missing')
      }
      const key = await this.untilAbort(this.ctx.credentials.resolve(credentialRef(identity.credentialRef)), signal)
      if (key === undefined) throw new JevError('CREDENTIAL_MISSING', 'Jev credential is not configured')
      const connection: JevConnection = { ...identity, apiKey: key.value }
      const issued = this.adapter.issue(snapshot, connection,
        featureId === undefined ? undefined : () => this.isEnabled(featureId),
        records => this.records().saveNetwork(operationId, attempt.id, records))
      networkRecords = issued.records
      try {
        let text: string | undefined
        let finished = false
        for await (const chunk of this.ctx.llm.stream({
          provider: JEV_PROVIDER, model: identity.model,
          messages: [{ role: 'user', content: [{ type: 'text', text: issued.envelope }] }], signal,
        })) {
          if (chunk.type === 'block-end' && chunk.block.type === 'text') text = chunk.block.text
          if (chunk.type === 'finish') {
            finished = true
            if (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted') {
              throw new JevError(
                outerSignal?.aborted ? 'CANCELLED' : timeout.aborted ? 'TIMEOUT' : chunk.reason.failure.code,
                outerSignal?.aborted ? 'Jev operation was cancelled' : timeout.aborted ? 'Jev request timed out' : 'Jev request failed',
              )
            }
            if (chunk.reason.kind !== 'stop') throw new JevError('INVALID_RESPONSE', 'Jev did not complete a typed answer')
          }
        }
        if (!finished || text === undefined) throw new JevError('INVALID_RESPONSE', 'Jev returned no answer')
        try {
          response = replayNetworkResponses(snapshot, networkRecords, identity.connectionId)
          rawResponse = networkRecords.length === 1 ? networkRecords[0]?.rawResponse : undefined
          const aggregated = aggregateUsage(networkRecords, true)
          usage = aggregated.usage
          usageComplete = aggregated.usageComplete
        } catch {
          throw new JevError('INVALID_RESPONSE', 'Jev answer failed complete type validation')
        }
      } finally {
        issued.release()
      }
      if (outerSignal?.aborted) throw new JevError('CANCELLED', 'Jev operation was cancelled')
      const interpretation = interpret === undefined ? { usable: true as const }
        : await this.untilAbort(Promise.resolve(interpret(response, outerSignal ?? signal)), outerSignal ?? signal)
      if (!interpretation.usable) {
        await this.records().settleAttempt(operationId, attempt.id, {
          status: 'failed', rawResponse, response, usage, usageComplete, networkRecords,
          interpretation,
          failure: { code: 'UNDETERMINED', message: interpretation.reason },
        }).catch(() => { throw new JevError('LOG_WRITE_FAILED', 'Jev result could not be saved') })
        return { ok: false, failure: { code: 'UNDETERMINED', message: interpretation.reason } }
      }
      if (outerSignal?.aborted) throw new JevError('CANCELLED', 'Jev operation was cancelled')
      await this.records().settleAttempt(operationId, attempt.id, { status: 'succeeded', rawResponse, response, usage, usageComplete, networkRecords, interpretation })
        .catch(() => { throw new JevError('LOG_WRITE_FAILED', 'Jev result could not be saved') })
      return { ok: true, attemptId: attempt.id, response }
    } catch (error) {
      if (error instanceof JevError && error.code === 'LOG_WRITE_FAILED') throw error
      const failure = outerSignal?.aborted ? { code: 'CANCELLED', message: 'Jev operation was cancelled' }
        : timeout.aborted ? { code: 'TIMEOUT', message: 'Jev request timed out' } : safeFailure(error)
      rawResponse = networkRecords.length === 1 ? networkRecords[0]?.rawResponse : undefined
      const expectedPackets = identity.connectionId === 'luna-openrouter' ? Math.ceil(snapshot.questions.length / 200) : 1
      const receivedAll = networkRecords.length === expectedPackets
        && networkRecords.every(record => record.dispatchedAt !== undefined && record.rawResponseText !== undefined)
      const aggregate = aggregateUsage(networkRecords, receivedAll)
      usage = aggregate.usage
      usageComplete = aggregate.usageComplete
      await this.records().settleAttempt(operationId, attempt.id, {
        status: failure.code === 'CANCELLED' ? 'cancelled' : 'failed',
        ...rawResponse === undefined ? {} : { rawResponse },
        ...usage === undefined ? {} : { usage }, usageComplete, networkRecords, failure,
      }).catch(() => { throw new JevError('LOG_WRITE_FAILED', 'Jev result could not be saved') })
      return { ok: false, failure }
    }
  }

  /** Record interrupted input without a model call, human question, or attempt; stable message links are idempotent. */
  recordInterrupted(featureId: string, link: JevOperationLink): Promise<JevRecordDetail> {
    return this.runActive(undefined, async () => {
      if (!this.features.has(featureId)) throw new JevError('UNKNOWN_FEATURE', 'Jev feature is not registered')
      if (!link.sessionId?.trim() || !link.inputVersion?.trim()) throw new JevError('INVALID_LINK', 'Interrupted records require a session and input identity')
      return this.records().createInterrupted(featureId, link)
    })
  }

  /** Record one rules-only candidate result with zero model attempts. */
  recordRuleObservation(featureId: string, link: JevOperationLink): Promise<JevRecordDetail> {
    return this.runActive(undefined, async () => {
      if (!this.features.has(featureId)) throw new JevError('UNKNOWN_FEATURE', 'Jev feature is not registered')
      return this.records().createRuleObservation(featureId, link)
    })
  }

  /** Attach a consumer fallback reason to an already failed or cancelled operation. */
  async noteFailure(operationId: string, code: string, message: string): Promise<void> {
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(code) || !message.trim()) throw new JevError('INVALID_NOTE', 'A failure code and reason are required')
    await this.records().noteFailure(operationId, { code, message })
  }

  /** Persist one action receipt; a failed write leaves execution status unconfirmed. */
  async writeReceipt(operationId: string, receipt: JevActionReceipt): Promise<JevRecordDetail> {
    if (this.records().get(operationId) === null) throw new JevError('UNKNOWN_OPERATION', 'Jev operation is not in this profile')
    try { return await this.records().receipt(operationId, receipt) }
    catch (error) {
      if (error instanceof Error && error.message.includes('conflicts')) throw new JevError('RECEIPT_CONFLICT', 'Jev action receipt id already has different facts')
      throw new JevError('RECEIPT_NOT_SAVED', 'Jev action receipt was not saved; do not repeat the action')
    }
  }
}

export default JevService
