/** Session-bound, read-only source viewer with explicit Jev stage analysis actions. */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { JevConnectionId } from '../types.ts'
import type {
  StageAnalysisRecord, StageAnalysisRequest, StageBatchState, StageLabel,
  StageMessage, StageNavigationSnapshot, StageStep, StageToolCall, StageTurn,
} from '../stage-types.ts'
import { stageNavigationItems, type StageSegment } from './stage-layout.ts'
import type { StageLocaleKey } from './stage-locales.ts'
import css from './StageNavigation.module.css'

type Translate = (key: StageLocaleKey) => string

/** Host commands available only for the active, authorized Session. */
export interface StageNavigationRemote {
  getStageNavigation(sessionId: string, signal: AbortSignal): Promise<StageNavigationSnapshot>
  startStageAnalysis(request: StageAnalysisRequest): Promise<StageBatchState>
  cancelStageAnalysis(batchId: string): Promise<void>
  getStageAnalysisRecord(sessionId: string, stepId: string, recordId?: string): Promise<StageAnalysisRecord | null>
}

/** Values supplied by the conversation view registration. */
export interface StageNavigationFace {
  sessionId: string
  jev: StageNavigationRemote
}

/** Locale and Host Remote face of the Session view. */
export type StageNavigationProps = PropsRuntime<'conversation.view'> & PropsLocale<'jev.stage'> & InjectFace<StageNavigationFace>

const LABEL_KEYS: Record<StageLabel, StageLocaleKey> = {
  input_parsing: 'stageInputParsing', problem_understanding: 'stageProblemUnderstanding',
  solution_planning: 'stageSolutionPlanning', implementation: 'stageImplementation',
  review_validation: 'stageReviewValidation', delivery_finalization: 'stageDeliveryFinalization',
  mixed: 'stageMixed', unknown: 'stageUnknown',
}

const CONNECTION_KEYS: Record<JevConnectionId, StageLocaleKey> = {
  jev: 'connectionJev', 'luna-openrouter': 'connectionLunaOpenRouter', 'luna-openai': 'connectionLunaOpenAI',
}

function format(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2) ?? ''
}

function requestText(requests: readonly StageMessage[]): string {
  return requests.flatMap(message => message.content.map(block => block.type === 'text' ? block.text : `[${block.type}]`)).join('\n')
}

function stepSource(step: StageStep): string {
  return JSON.stringify({ messages: step.messages, tools: step.tools, attemptSeqs: step.attemptSeqs })
}

function analysisLabel(step: StageStep, t: Translate): string {
  const analysis = step.analysis
  if (step.status === 'in-progress') return t('running')
  if (analysis.status === 'succeeded' && analysis.label !== undefined) return t(LABEL_KEYS[analysis.label])
  return t(analysis.status)
}

function turnStatus(turn: StageTurn, t: Translate): string {
  if (turn.endSeq === undefined) return t('running')
  switch (turn.reason?.kind) {
    case 'aborted': return turn.reason.reason.kind === 'user' ? t('aborted') : t('cancelled')
    case 'error': return t('endedWithError')
    case 'blocked': return t('blocked')
    case 'max-tokens': return t('maxTokens')
    case 'interrupted': return t('interrupted')
    case 'forked': return t('forked')
    default: return t('completed')
  }
}

function stageStepRange(segment: StageSegment): string {
  const first = segment.steps[0]!
  const last = segment.steps[segment.steps.length - 1]!
  return first.step === last.step ? String(first.step) : `${first.step}–${last.step}`
}

function Content({ blocks, t }: { blocks: readonly ContentBlock[]; t: Translate }) {
  return <div className={css.blocks}>{blocks.map((block, index) => {
    if (block.type === 'reasoning') return <details key={index} className={css.block}>
      <summary>{t('reasoning')} · {index + 1}</summary><pre className={css.sourceText}>{block.text}</pre>
    </details>
    if (block.type === 'text') return <div key={index} className={css.block}>
      <span className={css.blockLabel}>{t('assistantText')} · {index + 1}</span>
      <pre className={css.sourceText}>{block.text}</pre>
    </div>
    return <details key={index} className={css.block}>
      <summary>{block.type === 'tool-call' ? block.name : t('assistantOther')} · {index + 1}</summary>
      <pre className={css.sourceText}>{format(block)}</pre>
    </details>
  })}</div>
}

function Tool({ tool, t }: { tool: StageToolCall; t: Translate }) {
  return <details className={css.tool}>
    <summary><span>{tool.name}</span><span className={css.muted}>{!tool.dispatched ? t('notDispatched') : tool.result === undefined ? t('missingResult') : tool.result.isError ? t('toolError') : t('toolResult')}</span></summary>
    <div className={css.toolBody}>
      <div className={css.muted}>{tool.callId} · seq {tool.seq}{tool.result && ` → ${tool.result.seq}`}</div>
      <span className={css.blockLabel}>{t('toolArguments')}</span><pre className={css.sourceText}>{tool.arguments}</pre>
      <span className={css.blockLabel}>{t('toolResult')}</span>
      {tool.result === undefined ? <p className={css.muted}>{t('missingResult')}</p> : <>
        {tool.result.error && <pre className={css.sourceText}>{format(tool.result.error)}</pre>}
        <pre className={css.sourceText}>{format(tool.result.content)}</pre>
      </>}
    </div>
  </details>
}

function StepCard({ step, selected, inSegment, t, onDetails, detailsOpen, previousDetailsOpen, detail, detailLoading, detailFailed }: {
  step: StageStep; selected: boolean; inSegment: boolean; t: Translate
  onDetails: (recordId?: string) => void; detailsOpen: boolean; previousDetailsOpen: boolean; detail: StageAnalysisRecord | null | undefined
  detailLoading: boolean; detailFailed: boolean
}) {
  const analysis = step.analysis
  return <article data-step-id={step.id} className={[css.stepCard, selected ? css.focused : '', inSegment ? css.inSegment : ''].join(' ')}>
    <header className={css.stepHead}>
      <span className={css.stepNumber}>{t('step')} {step.step}</span>
      <span className={css.stageLabel}>{analysisLabel(step, t)}</span>
      <span className={css.muted}>seq {step.startSeq}{step.endSeq !== undefined && `–${step.endSeq}`}</span>
    </header>
    <div className={css.statusLine}>
      <span>{t('analysisStatus')}: {t(analysis.status)}</span>
      {analysis.connectionId !== undefined && <span>{t('connection')}: {t(CONNECTION_KEYS[analysis.connectionId])}</span>}
      {analysis.configuredModel && <span>{t('configuredModel')}: {analysis.configuredModel}</span>}
      <span>{t('model')}: {analysis.model ?? t('notProvided')}</span>
      {analysis.status === 'succeeded' && <span>{t('confidence')}: {analysis.confidence ?? t('notProvided')} · {t('uncalibrated')}</span>}
      {analysis.failure && <span className={css.error}>{analysis.failure.code}</span>}
      {step.assistant?.interrupted && <span className={css.error}>{t('aborted')}</span>}
      {step.tools.some(tool => tool.result?.isError) && <span className={css.error}>{t('toolError')}</span>}
      {step.tools.some(tool => !tool.dispatched) && <span className={css.muted}>{t('notDispatched')}</span>}
      {step.tools.some(tool => tool.dispatched && tool.result === undefined) && <span className={css.muted}>{t('missingResult')}</span>}
    </div>
    {analysis.status === 'stale' && <p className={css.muted}>{t('staleNotice')}</p>}
    {analysis.previousResult && <div className={css.previousResult}>
      <span>{t('previousSavedResult')}: {t(LABEL_KEYS[analysis.previousResult.label])}</span>
      <span>{t('confidence')}: {analysis.previousResult.confidence ?? t('notProvided')} · {t('uncalibrated')}</span>
      <span>{t('probabilities')}: {analysis.previousResult.probabilities === undefined ? t('notProvided') : format(analysis.previousResult.probabilities)}</span>
      {analysis.previousResult.configuredModel && <span>{t('configuredModel')}: {analysis.previousResult.configuredModel}</span>}
      {analysis.previousResult.connectionId !== undefined && <span>{t('connection')}: {t(CONNECTION_KEYS[analysis.previousResult.connectionId])}</span>}
      <span>{t('model')}: {analysis.previousResult.model ?? t('notProvided')}</span>
      {analysis.previousResult.stale && <span>{t('stale')}</span>}
      <button className={css.textButton} type="button" onClick={() => { onDetails(analysis.previousResult!.recordId) }} aria-expanded={previousDetailsOpen}>{previousDetailsOpen ? t('closeDetails') : t('viewPreviousRecord')}</button>
    </div>}
    {step.status === 'in-progress' && <p className={css.muted}>{t('notComplete')}</p>}
    {step.status === 'terminal-partial' && <p className={css.muted}>{t('terminalPartial')}</p>}
    {!step.classifiable && step.materialStatus === 'NO_MATERIAL' && <p className={css.muted}>{t('noMaterial')}</p>}
    {!step.classifiable && step.materialStatus === 'MATERIAL_TOO_LARGE' && <p className={css.muted}>{t('materialTooLarge')}</p>}
    {step.messages.length === 0 ? <p className={css.muted}>{t('noText')}</p> : step.messages.map(message => <div key={message.seq} className={css.message}>
      <span className={css.muted}>assistant · seq {message.seq}{message.interrupted && ` · ${t('aborted')}`}</span>
      <Content blocks={message.content} t={t} />
    </div>)}
    <div className={css.toolSection}>
      <h4>{t('tools')} · {step.tools.length}</h4>
      {step.tools.length === 0 ? <p className={css.muted}>{t('noTools')}</p> : step.tools.map(tool => <Tool key={tool.callId} tool={tool} t={t} />)}
    </div>
    {step.attemptSeqs.length > 0 && <details className={css.block}><summary>{t('attempts')} · {step.attemptSeqs.length}</summary><pre className={css.sourceText}>{step.attemptSeqs.join(', ')}</pre></details>}
    {(analysis.status !== 'unanalysed' && analysis.status !== 'unavailable' || analysis.previousResult !== undefined) && <div className={css.analysisSection}>
      <div className={css.statusLine}>
        <span>{t('analysis')}</span>
        <span>{t('probabilities')}: {analysis.probabilities === undefined ? t('notProvided') : format(analysis.probabilities)}</span>
        <button className={css.textButton} type="button" onClick={() => { onDetails() }} aria-expanded={detailsOpen}>{detailsOpen ? t('closeDetails') : t('details')}</button>
      </div>
      {(detailsOpen || previousDetailsOpen) && <div className={css.detailPanel}>
        {detailLoading && <span role="status">{t('loading')}</span>}
        {detailFailed && <span role="alert" className={css.error}>{t('detailFailed')}</span>}
        {detail && <>
          <p className={css.muted}>{t('redactionNote')}</p>
          <div className={css.muted}>{t('sourceStep')}: {detail.stepId} · {detail.ruleVersion}</div>
          {detail.connection !== undefined && <><span className={css.blockLabel}>{t('connection')}</span><pre className={css.sourceText}>{format(detail.connection)}</pre></>}
          <span className={css.blockLabel}>{t('requestSent')}</span><pre className={css.sourceText}>{detail.request === undefined ? t('notProvided') : format(detail.request)}</pre>
          <span className={css.blockLabel}>{t('rawResponse')}</span><pre className={css.sourceText}>{detail.rawResponse === undefined ? t('notProvided') : format(detail.rawResponse)}</pre>
          <span className={css.blockLabel}>{t('parsedResponse')}</span><pre className={css.sourceText}>{detail.response === undefined ? t('notProvided') : format(detail.response)}</pre>
          {detail.networkRecords !== undefined && <><span className={css.blockLabel}>{t('providerRequests')}</span><pre className={css.sourceText}>{format(detail.networkRecords)}</pre></>}
          {detail.usageComplete === false && <span className={css.muted}>{t('usageIncomplete')}</span>}
        </>}
      </div>}
    </div>}
  </article>
}

/** Render the Host's full authorized Session history and persisted Jev annotations. */
export function StageNavigation({ sessionId, jev, t, openView }: StageNavigationProps) {
  const [loadedSnapshot, setSnapshot] = useState<StageNavigationSnapshot | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [actionError, setActionError] = useState<StageLocaleKey | null>(null)
  const [busy, setBusy] = useState(false)
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(null)
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null)
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null)
  const [focusVersion, setFocusVersion] = useState(0)
  const [query, setQuery] = useState('')
  const [navigationOpen, setNavigationOpen] = useState(true)
  const [detailsTarget, setDetailsTarget] = useState<{ stepId: string; recordId?: string } | null>(null)
  const [detail, setDetail] = useState<StageAnalysisRecord | null | undefined>(undefined)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailFailed, setDetailFailed] = useState(false)
  const reader = useRef<HTMLDivElement>(null)
  const activeSession = useRef(sessionId)
  const readSequence = useRef(0)
  const detailSequence = useRef(0)
  const actionSequence = useRef(0)
  activeSession.current = sessionId
  const snapshot = loadedSnapshot?.sessionId === sessionId ? loadedSnapshot : null

  const refresh = useCallback(async (signal: AbortSignal) => {
    const sequence = ++readSequence.current
    try {
      const next = await jev.getStageNavigation(sessionId, signal)
      if (signal.aborted || activeSession.current !== sessionId || sequence !== readSequence.current || next.sessionId !== sessionId) return
      setSnapshot(next)
      setLoadError(false)
    } catch {
      if (!signal.aborted && activeSession.current === sessionId && sequence === readSequence.current) setLoadError(true)
    }
  }, [jev, sessionId])

  useEffect(() => {
    actionSequence.current++
    setSnapshot(null)
    setLoadError(false)
    setActionError(null)
    setBusy(false)
    setSelectedTurnId(null)
    setSelectedSegmentId(null)
    setSelectedStepId(null)
    setQuery('')
    setDetailsTarget(null)
    setDetail(undefined)
    setDetailFailed(false)
    detailSequence.current++
    const controller = new AbortController()
    void refresh(controller.signal)
    return () => { controller.abort() }
  }, [refresh])

  useEffect(() => {
    if (snapshot?.batch?.status !== 'running') return
    const controller = new AbortController()
    let active = true
    let timer: number
    const poll = async () => {
      await refresh(controller.signal)
      if (active) timer = window.setTimeout(() => { void poll() }, 900)
    }
    timer = window.setTimeout(() => { void poll() }, 900)
    return () => { active = false; window.clearTimeout(timer); controller.abort() }
  }, [refresh, snapshot?.batch?.id, snapshot?.batch?.status])

  useEffect(() => {
    if (snapshot?.featureEnabled === false) openView('chat', '')
  }, [openView, snapshot?.featureEnabled])

  const selectedTurn = snapshot?.turns.find(turn => turn.id === selectedTurnId)
    ?? snapshot?.turns[snapshot.turns.length - 1]
  const navigation = useMemo(() => selectedTurn ? stageNavigationItems(selectedTurn) : [], [selectedTurn])
  const selectedSegment = navigation.find(item => item.kind === 'segment' && item.id === selectedSegmentId)
  const segmentStepIds = new Set(selectedSegment?.kind === 'segment' ? selectedSegment.segment.steps.map(step => step.id) : [])
  const visibleSteps = selectedTurn?.steps.filter(step => query.trim() === '' || stepSource(step).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) ?? []
  const completedTurnCount = snapshot?.turns.filter(turn => turn.endSeq !== undefined).length ?? 0
  const turnReadySteps = selectedTurn?.endSeq === undefined ? [] : selectedTurn.steps.filter(step => step.classifiable)
  const allReadySteps = snapshot?.turns.filter(turn => turn.endSeq !== undefined).flatMap(turn => turn.steps).filter(step => step.classifiable) ?? []
  const missingTurnCount = turnReadySteps.filter(step => step.analysis.status === 'unanalysed').length
  const missingAllCount = allReadySteps.filter(step => step.analysis.status === 'unanalysed').length
  const retryTurnCount = turnReadySteps.filter(step => step.analysis.status === 'failed' || step.analysis.status === 'cancelled' || step.analysis.status === 'interrupted').length
  const refreshTurnCount = turnReadySteps.length
  const featureEnabled = snapshot?.featureEnabled ?? false
  const batchRunning = snapshot?.batch?.status === 'running'

  useLayoutEffect(() => {
    if (selectedStepId === null) return
    const container = reader.current
    const step = [...(container?.querySelectorAll<HTMLElement>('[data-step-id]') ?? [])].find(node => node.dataset.stepId === selectedStepId)
    if (container && step) container.scrollTop += step.getBoundingClientRect().top - container.getBoundingClientRect().top - 14
  }, [selectedStepId, selectedTurn?.id, focusVersion])

  const chooseTurn = (turn: StageTurn) => {
    setSelectedTurnId(turn.id)
    setSelectedSegmentId(null)
    setSelectedStepId(null)
    setQuery('')
    if (reader.current) reader.current.scrollTop = 0
  }

  const chooseSegment = (turn: StageTurn, segment: StageSegment) => {
    setSelectedTurnId(turn.id)
    setSelectedSegmentId(segment.id)
    setSelectedStepId(segment.firstStepId)
    setFocusVersion(value => value + 1)
    setQuery('')
  }

  const start = async (scope: StageAnalysisRequest['scope'], mode: StageAnalysisRequest['mode']) => {
    if (busy || batchRunning || !featureEnabled) return
    const sequence = ++actionSequence.current
    setBusy(true)
    setActionError(null)
    try {
      const batch = await jev.startStageAnalysis({ sessionId, scope, mode })
      if (activeSession.current !== sessionId || sequence !== actionSequence.current) return
      setSnapshot(previous => previous?.sessionId === sessionId ? { ...previous, batch } : previous)
      await refresh(new AbortController().signal)
    } catch { if (activeSession.current === sessionId && sequence === actionSequence.current) setActionError('analyzeFailed') }
    finally { if (activeSession.current === sessionId && sequence === actionSequence.current) setBusy(false) }
  }

  const cancel = async () => {
    const batch = snapshot?.batch
    if (!batch || batch.status !== 'running' || busy) return
    const sequence = ++actionSequence.current
    setBusy(true)
    setActionError(null)
    try {
      await jev.cancelStageAnalysis(batch.id)
      if (activeSession.current !== sessionId || sequence !== actionSequence.current) return
      await refresh(new AbortController().signal)
    } catch { if (activeSession.current === sessionId && sequence === actionSequence.current) setActionError('cancelFailed') }
    finally { if (activeSession.current === sessionId && sequence === actionSequence.current) setBusy(false) }
  }

  const toggleDetails = async (stepId: string, recordId?: string) => {
    const sequence = ++detailSequence.current
    if (detailsTarget?.stepId === stepId && detailsTarget.recordId === recordId) { setDetailsTarget(null); return }
    setDetailsTarget({ stepId, ...recordId === undefined ? {} : { recordId } })
    setDetail(undefined)
    setDetailLoading(true)
    setDetailFailed(false)
    try {
      const result = recordId === undefined
        ? await jev.getStageAnalysisRecord(sessionId, stepId)
        : await jev.getStageAnalysisRecord(sessionId, stepId, recordId)
      if (activeSession.current === sessionId && sequence === detailSequence.current) setDetail(result)
    } catch { if (activeSession.current === sessionId && sequence === detailSequence.current) setDetailFailed(true) }
    finally { if (activeSession.current === sessionId && sequence === detailSequence.current) setDetailLoading(false) }
  }

  if (snapshot?.featureEnabled === false) return null

  return <section className={css.page} aria-label={t('title')}>
    <div className={css.toolbar}>
      <h2>{t('title')}</h2>
      <div className={css.toolbarActions}>
        <button type="button" className={css.mobileToggle} onClick={() => { setNavigationOpen(open => !open) }} aria-expanded={navigationOpen}>{navigationOpen ? t('hideNavigation') : t('showNavigation')}</button>
        <Button size="sm" variant="outline" onClick={() => { void refresh(new AbortController().signal) }}>{t('refresh')}</Button>
        {featureEnabled && selectedTurn?.endSeq !== undefined && <Button size="sm" disabled={busy || batchRunning || missingTurnCount === 0} onClick={() => { void start({ kind: 'turn', turn: selectedTurn.turn }, 'missing') }}>{t('analyzeTurn')}</Button>}
        {featureEnabled && completedTurnCount > 0 && <Button size="sm" variant="outline" disabled={busy || batchRunning || missingAllCount === 0} onClick={() => { void start({ kind: 'all' }, 'missing') }}>{t('analyzeAll')}</Button>}
        {featureEnabled && selectedTurn?.endSeq !== undefined && selectedTurn.steps.some(step => ['failed', 'cancelled', 'interrupted'].includes(step.analysis.status)) && <Button size="sm" variant="outline" disabled={busy || batchRunning || retryTurnCount === 0} onClick={() => { void start({ kind: 'turn', turn: selectedTurn.turn }, 'retry-failed') }}>{t('retryFailed')}</Button>}
        {featureEnabled && selectedTurn?.endSeq !== undefined && selectedTurn.steps.some(step => step.analysis.status === 'succeeded' || step.analysis.status === 'stale') && <Button size="sm" variant="outline" disabled={busy || batchRunning || refreshTurnCount === 0} onClick={() => { void start({ kind: 'turn', turn: selectedTurn.turn }, 'refresh') }}>{t('reanalyzeTurn')}</Button>}
        {batchRunning && <Button size="sm" variant="outline" disabled={busy} onClick={() => { void cancel() }}>{t('cancel')}</Button>}
      </div>
      <p className={css.scopeHint}>{t('missingTurnCount')}: {missingTurnCount} {t('steps')} · {t('missingAllCount')}: {missingAllCount} {t('steps')} · {t('retryTurnCount')}: {retryTurnCount} {t('steps')} · {t('refreshTurnCount')}: {refreshTurnCount} {t('steps')} ({t('refreshWarning')}) · {t('scopeHint')}</p>
      {snapshot?.batch && <p role="status" className={css.progress}>{t('batchProgress')}: {snapshot.batch.completed + snapshot.batch.failed + snapshot.batch.cancelled} / {snapshot.batch.total} · {t(snapshot.batch.status === 'running' ? 'analyzing' : snapshot.batch.status)}{snapshot.batch.failure && ` · ${snapshot.batch.failure.code}`}</p>}
      {actionError && <p role="alert" className={css.error}>{t(actionError)}</p>}
      {loadError && <p role="alert" className={css.error}>{t('loadFailed')}</p>}
    </div>
    {snapshot === null ? <div className={css.loading} role="status" aria-label={t('loading')}><StateDot state="ongoing" size={24} /></div> :
      <div className={css.layout}>
        <nav className={[css.navigation, navigationOpen ? '' : css.navigationClosed].join(' ')} aria-label={t('navigation')}>
          <h3>{t('navigation')} · {snapshot.turns.length}</h3>
          {snapshot.turns.map(turn => <div key={turn.id} className={css.turnItem}>
            <button type="button" className={[css.turnButton, selectedTurn?.id === turn.id ? css.activeTurn : ''].join(' ')} onClick={() => { chooseTurn(turn) }} aria-current={selectedTurn?.id === turn.id ? 'true' : undefined}>
              <span>{t('turn')} {turn.turn} · {requestText(turn.requests) || t('request')}</span>
              <small>{turn.steps.length} {t('steps')} · {turnStatus(turn, t)}</small>
            </button>
            <div className={css.segments}>
              {stageNavigationItems(turn).map(item => item.kind === 'segment'
                ? <button key={item.id} type="button" className={[css.segmentButton, selectedSegmentId === item.id ? css.activeSegment : ''].join(' ')} onClick={() => { chooseSegment(turn, item.segment) }} aria-current={selectedSegmentId === item.id ? 'true' : undefined}>
                    <span>{t(LABEL_KEYS[item.segment.label])}</span><small>{t('step')} {stageStepRange(item.segment)}</small>
                  </button>
                : <button key={item.id} type="button" className={css.gapButton} onClick={() => { chooseTurn(turn); setSelectedStepId(item.step.id); setFocusVersion(value => value + 1) }}>
                    <span>{t('step')} {item.step.step}</span><small>{analysisLabel(item.step, t)}</small>
                  </button>)}
            </div>
          </div>)}
        </nav>
        <div className={css.reader} ref={reader}>
          {!selectedTurn ? <p className={css.empty}>{t('emptySession')}</p> : <div className={css.readerInner}>
            <div className={css.readerHeader}>
              <h3>{t('turn')} {selectedTurn.turn} · {turnStatus(selectedTurn, t)}</h3>
              <span className={css.muted}>{selectedTurn.steps.length} {t('steps')} · seq {selectedTurn.startSeq}{selectedTurn.endSeq !== undefined && `–${selectedTurn.endSeq}`}</span>
            </div>
            <section className={css.request}><h4>{t('request')}</h4><pre className={css.sourceText}>{requestText(selectedTurn.requests) || t('notProvided')}</pre>
              <details><summary>{t('source')}</summary><pre className={css.sourceText}>{format(selectedTurn.requests)}</pre></details>
            </section>
            <div className={css.readerHeading}>
              <h3>{t('source')}</h3>
              <label className={css.search}>{t('search')}<input value={query} onChange={event => { setQuery(event.target.value) }} placeholder={t('search')} /></label>
              {query && <button type="button" className={css.textButton} onClick={() => { setQuery('') }}>{t('clearSearch')}</button>}
            </div>
            {selectedTurn.steps.length === 0 ? <p className={css.empty}>{t('emptyTurn')}</p> : visibleSteps.length === 0 ? <p className={css.empty}>{t('emptySearch')}</p> : visibleSteps.map(step => <StepCard key={step.id} step={step} t={t}
              selected={selectedStepId === step.id} inSegment={segmentStepIds.has(step.id)}
              onDetails={recordId => { void toggleDetails(step.id, recordId) }} detailsOpen={detailsTarget?.stepId === step.id && detailsTarget.recordId === undefined}
              previousDetailsOpen={detailsTarget?.stepId === step.id && detailsTarget.recordId !== undefined}
              detail={detailsTarget?.stepId === step.id ? detail : undefined} detailLoading={detailsTarget?.stepId === step.id && detailLoading} detailFailed={detailsTarget?.stepId === step.id && detailFailed} />)}
          </div>}
        </div>
      </div>}
  </section>
}
