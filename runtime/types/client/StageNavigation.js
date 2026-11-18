import { jsxs as _jsxs, jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
/** Session-bound, read-only source viewer with explicit Jev stage analysis actions. */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button, StateDot } from '@deepseek-ai/dsh-client-ui-primitives';
import { stageNavigationItems } from "./stage-layout.js";
import css from './StageNavigation.module.css';
const LABEL_KEYS = {
    input_parsing: 'stageInputParsing', problem_understanding: 'stageProblemUnderstanding',
    solution_planning: 'stageSolutionPlanning', implementation: 'stageImplementation',
    review_validation: 'stageReviewValidation', delivery_finalization: 'stageDeliveryFinalization',
    mixed: 'stageMixed', unknown: 'stageUnknown',
};
const CONNECTION_KEYS = {
    jev: 'connectionJev', 'luna-openrouter': 'connectionLunaOpenRouter', 'luna-openai': 'connectionLunaOpenAI',
};
function format(value) {
    if (typeof value === 'string')
        return value;
    return JSON.stringify(value, null, 2) ?? '';
}
function requestText(requests) {
    return requests.flatMap(message => message.content.map(block => block.type === 'text' ? block.text : `[${block.type}]`)).join('\n');
}
function stepSource(step) {
    return JSON.stringify({ messages: step.messages, tools: step.tools, attemptSeqs: step.attemptSeqs });
}
function analysisLabel(step, t) {
    const analysis = step.analysis;
    if (step.status === 'in-progress')
        return t('running');
    if (analysis.status === 'succeeded' && analysis.label !== undefined)
        return t(LABEL_KEYS[analysis.label]);
    return t(analysis.status);
}
function turnStatus(turn, t) {
    if (turn.endSeq === undefined)
        return t('running');
    switch (turn.reason?.kind) {
        case 'aborted': return turn.reason.reason.kind === 'user' ? t('aborted') : t('cancelled');
        case 'error': return t('endedWithError');
        case 'blocked': return t('blocked');
        case 'max-tokens': return t('maxTokens');
        case 'interrupted': return t('interrupted');
        case 'forked': return t('forked');
        default: return t('completed');
    }
}
function stageStepRange(segment) {
    const first = segment.steps[0];
    const last = segment.steps[segment.steps.length - 1];
    return first.step === last.step ? String(first.step) : `${first.step}–${last.step}`;
}
function Content({ blocks, t }) {
    return _jsx("div", { className: css.blocks, children: blocks.map((block, index) => {
            if (block.type === 'reasoning')
                return _jsxs("details", { className: css.block, children: [_jsxs("summary", { children: [t('reasoning'), " \u00B7 ", index + 1] }), _jsx("pre", { className: css.sourceText, children: block.text })] }, index);
            if (block.type === 'text')
                return _jsxs("div", { className: css.block, children: [_jsxs("span", { className: css.blockLabel, children: [t('assistantText'), " \u00B7 ", index + 1] }), _jsx("pre", { className: css.sourceText, children: block.text })] }, index);
            return _jsxs("details", { className: css.block, children: [_jsxs("summary", { children: [block.type === 'tool-call' ? block.name : t('assistantOther'), " \u00B7 ", index + 1] }), _jsx("pre", { className: css.sourceText, children: format(block) })] }, index);
        }) });
}
function Tool({ tool, t }) {
    return _jsxs("details", { className: css.tool, children: [_jsxs("summary", { children: [_jsx("span", { children: tool.name }), _jsx("span", { className: css.muted, children: !tool.dispatched ? t('notDispatched') : tool.result === undefined ? t('missingResult') : tool.result.isError ? t('toolError') : t('toolResult') })] }), _jsxs("div", { className: css.toolBody, children: [_jsxs("div", { className: css.muted, children: [tool.callId, " \u00B7 seq ", tool.seq, tool.result && ` → ${tool.result.seq}`] }), _jsx("span", { className: css.blockLabel, children: t('toolArguments') }), _jsx("pre", { className: css.sourceText, children: tool.arguments }), _jsx("span", { className: css.blockLabel, children: t('toolResult') }), tool.result === undefined ? _jsx("p", { className: css.muted, children: t('missingResult') }) : _jsxs(_Fragment, { children: [tool.result.error && _jsx("pre", { className: css.sourceText, children: format(tool.result.error) }), _jsx("pre", { className: css.sourceText, children: format(tool.result.content) })] })] })] });
}
function StepCard({ step, selected, inSegment, t, onDetails, detailsOpen, previousDetailsOpen, detail, detailLoading, detailFailed }) {
    const analysis = step.analysis;
    return _jsxs("article", { "data-step-id": step.id, className: [css.stepCard, selected ? css.focused : '', inSegment ? css.inSegment : ''].join(' '), children: [_jsxs("header", { className: css.stepHead, children: [_jsxs("span", { className: css.stepNumber, children: [t('step'), " ", step.step] }), _jsx("span", { className: css.stageLabel, children: analysisLabel(step, t) }), _jsxs("span", { className: css.muted, children: ["seq ", step.startSeq, step.endSeq !== undefined && `–${step.endSeq}`] })] }), _jsxs("div", { className: css.statusLine, children: [_jsxs("span", { children: [t('analysisStatus'), ": ", t(analysis.status)] }), analysis.connectionId !== undefined && _jsxs("span", { children: [t('connection'), ": ", t(CONNECTION_KEYS[analysis.connectionId])] }), analysis.configuredModel && _jsxs("span", { children: [t('configuredModel'), ": ", analysis.configuredModel] }), _jsxs("span", { children: [t('model'), ": ", analysis.model ?? t('notProvided')] }), analysis.status === 'succeeded' && _jsxs("span", { children: [t('confidence'), ": ", analysis.confidence ?? t('notProvided'), " \u00B7 ", t('uncalibrated')] }), analysis.failure && _jsx("span", { className: css.error, children: analysis.failure.code }), step.assistant?.interrupted && _jsx("span", { className: css.error, children: t('aborted') }), step.tools.some(tool => tool.result?.isError) && _jsx("span", { className: css.error, children: t('toolError') }), step.tools.some(tool => !tool.dispatched) && _jsx("span", { className: css.muted, children: t('notDispatched') }), step.tools.some(tool => tool.dispatched && tool.result === undefined) && _jsx("span", { className: css.muted, children: t('missingResult') })] }), analysis.status === 'stale' && _jsx("p", { className: css.muted, children: t('staleNotice') }), analysis.previousResult && _jsxs("div", { className: css.previousResult, children: [_jsxs("span", { children: [t('previousSavedResult'), ": ", t(LABEL_KEYS[analysis.previousResult.label])] }), _jsxs("span", { children: [t('confidence'), ": ", analysis.previousResult.confidence ?? t('notProvided'), " \u00B7 ", t('uncalibrated')] }), _jsxs("span", { children: [t('probabilities'), ": ", analysis.previousResult.probabilities === undefined ? t('notProvided') : format(analysis.previousResult.probabilities)] }), analysis.previousResult.configuredModel && _jsxs("span", { children: [t('configuredModel'), ": ", analysis.previousResult.configuredModel] }), analysis.previousResult.connectionId !== undefined && _jsxs("span", { children: [t('connection'), ": ", t(CONNECTION_KEYS[analysis.previousResult.connectionId])] }), _jsxs("span", { children: [t('model'), ": ", analysis.previousResult.model ?? t('notProvided')] }), analysis.previousResult.stale && _jsx("span", { children: t('stale') }), _jsx("button", { className: css.textButton, type: "button", onClick: () => { onDetails(analysis.previousResult.recordId); }, "aria-expanded": previousDetailsOpen, children: previousDetailsOpen ? t('closeDetails') : t('viewPreviousRecord') })] }), step.status === 'in-progress' && _jsx("p", { className: css.muted, children: t('notComplete') }), step.status === 'terminal-partial' && _jsx("p", { className: css.muted, children: t('terminalPartial') }), !step.classifiable && step.materialStatus === 'NO_MATERIAL' && _jsx("p", { className: css.muted, children: t('noMaterial') }), !step.classifiable && step.materialStatus === 'MATERIAL_TOO_LARGE' && _jsx("p", { className: css.muted, children: t('materialTooLarge') }), step.messages.length === 0 ? _jsx("p", { className: css.muted, children: t('noText') }) : step.messages.map(message => _jsxs("div", { className: css.message, children: [_jsxs("span", { className: css.muted, children: ["assistant \u00B7 seq ", message.seq, message.interrupted && ` · ${t('aborted')}`] }), _jsx(Content, { blocks: message.content, t: t })] }, message.seq)), _jsxs("div", { className: css.toolSection, children: [_jsxs("h4", { children: [t('tools'), " \u00B7 ", step.tools.length] }), step.tools.length === 0 ? _jsx("p", { className: css.muted, children: t('noTools') }) : step.tools.map(tool => _jsx(Tool, { tool: tool, t: t }, tool.callId))] }), step.attemptSeqs.length > 0 && _jsxs("details", { className: css.block, children: [_jsxs("summary", { children: [t('attempts'), " \u00B7 ", step.attemptSeqs.length] }), _jsx("pre", { className: css.sourceText, children: step.attemptSeqs.join(', ') })] }), (analysis.status !== 'unanalysed' && analysis.status !== 'unavailable' || analysis.previousResult !== undefined) && _jsxs("div", { className: css.analysisSection, children: [_jsxs("div", { className: css.statusLine, children: [_jsx("span", { children: t('analysis') }), _jsxs("span", { children: [t('probabilities'), ": ", analysis.probabilities === undefined ? t('notProvided') : format(analysis.probabilities)] }), _jsx("button", { className: css.textButton, type: "button", onClick: () => { onDetails(); }, "aria-expanded": detailsOpen, children: detailsOpen ? t('closeDetails') : t('details') })] }), (detailsOpen || previousDetailsOpen) && _jsxs("div", { className: css.detailPanel, children: [detailLoading && _jsx("span", { role: "status", children: t('loading') }), detailFailed && _jsx("span", { role: "alert", className: css.error, children: t('detailFailed') }), detail && _jsxs(_Fragment, { children: [_jsx("p", { className: css.muted, children: t('redactionNote') }), _jsxs("div", { className: css.muted, children: [t('sourceStep'), ": ", detail.stepId, " \u00B7 ", detail.ruleVersion] }), detail.connection !== undefined && _jsxs(_Fragment, { children: [_jsx("span", { className: css.blockLabel, children: t('connection') }), _jsx("pre", { className: css.sourceText, children: format(detail.connection) })] }), _jsx("span", { className: css.blockLabel, children: t('requestSent') }), _jsx("pre", { className: css.sourceText, children: detail.request === undefined ? t('notProvided') : format(detail.request) }), _jsx("span", { className: css.blockLabel, children: t('rawResponse') }), _jsx("pre", { className: css.sourceText, children: detail.rawResponse === undefined ? t('notProvided') : format(detail.rawResponse) }), _jsx("span", { className: css.blockLabel, children: t('parsedResponse') }), _jsx("pre", { className: css.sourceText, children: detail.response === undefined ? t('notProvided') : format(detail.response) }), detail.networkRecords !== undefined && _jsxs(_Fragment, { children: [_jsx("span", { className: css.blockLabel, children: t('providerRequests') }), _jsx("pre", { className: css.sourceText, children: format(detail.networkRecords) })] }), detail.usageComplete === false && _jsx("span", { className: css.muted, children: t('usageIncomplete') })] })] })] })] });
}
/** Render the Host's full authorized Session history and persisted Jev annotations. */
export function StageNavigation({ sessionId, jev, t, openView }) {
    const [loadedSnapshot, setSnapshot] = useState(null);
    const [loadError, setLoadError] = useState(false);
    const [actionError, setActionError] = useState(null);
    const [busy, setBusy] = useState(false);
    const [selectedTurnId, setSelectedTurnId] = useState(null);
    const [selectedSegmentId, setSelectedSegmentId] = useState(null);
    const [selectedStepId, setSelectedStepId] = useState(null);
    const [focusVersion, setFocusVersion] = useState(0);
    const [query, setQuery] = useState('');
    const [navigationOpen, setNavigationOpen] = useState(true);
    const [detailsTarget, setDetailsTarget] = useState(null);
    const [detail, setDetail] = useState(undefined);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailFailed, setDetailFailed] = useState(false);
    const reader = useRef(null);
    const activeSession = useRef(sessionId);
    const readSequence = useRef(0);
    const detailSequence = useRef(0);
    const actionSequence = useRef(0);
    activeSession.current = sessionId;
    const snapshot = loadedSnapshot?.sessionId === sessionId ? loadedSnapshot : null;
    const refresh = useCallback(async (signal) => {
        const sequence = ++readSequence.current;
        try {
            const next = await jev.getStageNavigation(sessionId, signal);
            if (signal.aborted || activeSession.current !== sessionId || sequence !== readSequence.current || next.sessionId !== sessionId)
                return;
            setSnapshot(next);
            setLoadError(false);
        }
        catch {
            if (!signal.aborted && activeSession.current === sessionId && sequence === readSequence.current)
                setLoadError(true);
        }
    }, [jev, sessionId]);
    useEffect(() => {
        actionSequence.current++;
        setSnapshot(null);
        setLoadError(false);
        setActionError(null);
        setBusy(false);
        setSelectedTurnId(null);
        setSelectedSegmentId(null);
        setSelectedStepId(null);
        setQuery('');
        setDetailsTarget(null);
        setDetail(undefined);
        setDetailFailed(false);
        detailSequence.current++;
        const controller = new AbortController();
        void refresh(controller.signal);
        return () => { controller.abort(); };
    }, [refresh]);
    useEffect(() => {
        if (snapshot?.batch?.status !== 'running')
            return;
        const controller = new AbortController();
        let active = true;
        let timer;
        const poll = async () => {
            await refresh(controller.signal);
            if (active)
                timer = window.setTimeout(() => { void poll(); }, 900);
        };
        timer = window.setTimeout(() => { void poll(); }, 900);
        return () => { active = false; window.clearTimeout(timer); controller.abort(); };
    }, [refresh, snapshot?.batch?.id, snapshot?.batch?.status]);
    useEffect(() => {
        if (snapshot?.featureEnabled === false)
            openView('chat', '');
    }, [openView, snapshot?.featureEnabled]);
    const selectedTurn = snapshot?.turns.find(turn => turn.id === selectedTurnId)
        ?? snapshot?.turns[snapshot.turns.length - 1];
    const navigation = useMemo(() => selectedTurn ? stageNavigationItems(selectedTurn) : [], [selectedTurn]);
    const selectedSegment = navigation.find(item => item.kind === 'segment' && item.id === selectedSegmentId);
    const segmentStepIds = new Set(selectedSegment?.kind === 'segment' ? selectedSegment.segment.steps.map(step => step.id) : []);
    const visibleSteps = selectedTurn?.steps.filter(step => query.trim() === '' || stepSource(step).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) ?? [];
    const completedTurnCount = snapshot?.turns.filter(turn => turn.endSeq !== undefined).length ?? 0;
    const turnReadySteps = selectedTurn?.endSeq === undefined ? [] : selectedTurn.steps.filter(step => step.classifiable);
    const allReadySteps = snapshot?.turns.filter(turn => turn.endSeq !== undefined).flatMap(turn => turn.steps).filter(step => step.classifiable) ?? [];
    const missingTurnCount = turnReadySteps.filter(step => step.analysis.status === 'unanalysed').length;
    const missingAllCount = allReadySteps.filter(step => step.analysis.status === 'unanalysed').length;
    const retryTurnCount = turnReadySteps.filter(step => step.analysis.status === 'failed' || step.analysis.status === 'cancelled' || step.analysis.status === 'interrupted').length;
    const refreshTurnCount = turnReadySteps.length;
    const featureEnabled = snapshot?.featureEnabled ?? false;
    const batchRunning = snapshot?.batch?.status === 'running';
    useLayoutEffect(() => {
        if (selectedStepId === null)
            return;
        const container = reader.current;
        const step = [...(container?.querySelectorAll('[data-step-id]') ?? [])].find(node => node.dataset.stepId === selectedStepId);
        if (container && step)
            container.scrollTop += step.getBoundingClientRect().top - container.getBoundingClientRect().top - 14;
    }, [selectedStepId, selectedTurn?.id, focusVersion]);
    const chooseTurn = (turn) => {
        setSelectedTurnId(turn.id);
        setSelectedSegmentId(null);
        setSelectedStepId(null);
        setQuery('');
        if (reader.current)
            reader.current.scrollTop = 0;
    };
    const chooseSegment = (turn, segment) => {
        setSelectedTurnId(turn.id);
        setSelectedSegmentId(segment.id);
        setSelectedStepId(segment.firstStepId);
        setFocusVersion(value => value + 1);
        setQuery('');
    };
    const start = async (scope, mode) => {
        if (busy || batchRunning || !featureEnabled)
            return;
        const sequence = ++actionSequence.current;
        setBusy(true);
        setActionError(null);
        try {
            const batch = await jev.startStageAnalysis({ sessionId, scope, mode });
            if (activeSession.current !== sessionId || sequence !== actionSequence.current)
                return;
            setSnapshot(previous => previous?.sessionId === sessionId ? { ...previous, batch } : previous);
            await refresh(new AbortController().signal);
        }
        catch {
            if (activeSession.current === sessionId && sequence === actionSequence.current)
                setActionError('analyzeFailed');
        }
        finally {
            if (activeSession.current === sessionId && sequence === actionSequence.current)
                setBusy(false);
        }
    };
    const cancel = async () => {
        const batch = snapshot?.batch;
        if (!batch || batch.status !== 'running' || busy)
            return;
        const sequence = ++actionSequence.current;
        setBusy(true);
        setActionError(null);
        try {
            await jev.cancelStageAnalysis(batch.id);
            if (activeSession.current !== sessionId || sequence !== actionSequence.current)
                return;
            await refresh(new AbortController().signal);
        }
        catch {
            if (activeSession.current === sessionId && sequence === actionSequence.current)
                setActionError('cancelFailed');
        }
        finally {
            if (activeSession.current === sessionId && sequence === actionSequence.current)
                setBusy(false);
        }
    };
    const toggleDetails = async (stepId, recordId) => {
        const sequence = ++detailSequence.current;
        if (detailsTarget?.stepId === stepId && detailsTarget.recordId === recordId) {
            setDetailsTarget(null);
            return;
        }
        setDetailsTarget({ stepId, ...recordId === undefined ? {} : { recordId } });
        setDetail(undefined);
        setDetailLoading(true);
        setDetailFailed(false);
        try {
            const result = recordId === undefined
                ? await jev.getStageAnalysisRecord(sessionId, stepId)
                : await jev.getStageAnalysisRecord(sessionId, stepId, recordId);
            if (activeSession.current === sessionId && sequence === detailSequence.current)
                setDetail(result);
        }
        catch {
            if (activeSession.current === sessionId && sequence === detailSequence.current)
                setDetailFailed(true);
        }
        finally {
            if (activeSession.current === sessionId && sequence === detailSequence.current)
                setDetailLoading(false);
        }
    };
    if (snapshot?.featureEnabled === false)
        return null;
    return _jsxs("section", { className: css.page, "aria-label": t('title'), children: [_jsxs("div", { className: css.toolbar, children: [_jsx("h2", { children: t('title') }), _jsxs("div", { className: css.toolbarActions, children: [_jsx("button", { type: "button", className: css.mobileToggle, onClick: () => { setNavigationOpen(open => !open); }, "aria-expanded": navigationOpen, children: navigationOpen ? t('hideNavigation') : t('showNavigation') }), _jsx(Button, { size: "sm", variant: "outline", onClick: () => { void refresh(new AbortController().signal); }, children: t('refresh') }), featureEnabled && selectedTurn?.endSeq !== undefined && _jsx(Button, { size: "sm", disabled: busy || batchRunning || missingTurnCount === 0, onClick: () => { void start({ kind: 'turn', turn: selectedTurn.turn }, 'missing'); }, children: t('analyzeTurn') }), featureEnabled && completedTurnCount > 0 && _jsx(Button, { size: "sm", variant: "outline", disabled: busy || batchRunning || missingAllCount === 0, onClick: () => { void start({ kind: 'all' }, 'missing'); }, children: t('analyzeAll') }), featureEnabled && selectedTurn?.endSeq !== undefined && selectedTurn.steps.some(step => ['failed', 'cancelled', 'interrupted'].includes(step.analysis.status)) && _jsx(Button, { size: "sm", variant: "outline", disabled: busy || batchRunning || retryTurnCount === 0, onClick: () => { void start({ kind: 'turn', turn: selectedTurn.turn }, 'retry-failed'); }, children: t('retryFailed') }), featureEnabled && selectedTurn?.endSeq !== undefined && selectedTurn.steps.some(step => step.analysis.status === 'succeeded' || step.analysis.status === 'stale') && _jsx(Button, { size: "sm", variant: "outline", disabled: busy || batchRunning || refreshTurnCount === 0, onClick: () => { void start({ kind: 'turn', turn: selectedTurn.turn }, 'refresh'); }, children: t('reanalyzeTurn') }), batchRunning && _jsx(Button, { size: "sm", variant: "outline", disabled: busy, onClick: () => { void cancel(); }, children: t('cancel') })] }), _jsxs("p", { className: css.scopeHint, children: [t('missingTurnCount'), ": ", missingTurnCount, " ", t('steps'), " \u00B7 ", t('missingAllCount'), ": ", missingAllCount, " ", t('steps'), " \u00B7 ", t('retryTurnCount'), ": ", retryTurnCount, " ", t('steps'), " \u00B7 ", t('refreshTurnCount'), ": ", refreshTurnCount, " ", t('steps'), " (", t('refreshWarning'), ") \u00B7 ", t('scopeHint')] }), snapshot?.batch && _jsxs("p", { role: "status", className: css.progress, children: [t('batchProgress'), ": ", snapshot.batch.completed + snapshot.batch.failed + snapshot.batch.cancelled, " / ", snapshot.batch.total, " \u00B7 ", t(snapshot.batch.status === 'running' ? 'analyzing' : snapshot.batch.status), snapshot.batch.failure && ` · ${snapshot.batch.failure.code}`] }), actionError && _jsx("p", { role: "alert", className: css.error, children: t(actionError) }), loadError && _jsx("p", { role: "alert", className: css.error, children: t('loadFailed') })] }), snapshot === null ? _jsx("div", { className: css.loading, role: "status", "aria-label": t('loading'), children: _jsx(StateDot, { state: "ongoing", size: 24 }) }) :
                _jsxs("div", { className: css.layout, children: [_jsxs("nav", { className: [css.navigation, navigationOpen ? '' : css.navigationClosed].join(' '), "aria-label": t('navigation'), children: [_jsxs("h3", { children: [t('navigation'), " \u00B7 ", snapshot.turns.length] }), snapshot.turns.map(turn => _jsxs("div", { className: css.turnItem, children: [_jsxs("button", { type: "button", className: [css.turnButton, selectedTurn?.id === turn.id ? css.activeTurn : ''].join(' '), onClick: () => { chooseTurn(turn); }, "aria-current": selectedTurn?.id === turn.id ? 'true' : undefined, children: [_jsxs("span", { children: [t('turn'), " ", turn.turn, " \u00B7 ", requestText(turn.requests) || t('request')] }), _jsxs("small", { children: [turn.steps.length, " ", t('steps'), " \u00B7 ", turnStatus(turn, t)] })] }), _jsx("div", { className: css.segments, children: stageNavigationItems(turn).map(item => item.kind === 'segment'
                                                ? _jsxs("button", { type: "button", className: [css.segmentButton, selectedSegmentId === item.id ? css.activeSegment : ''].join(' '), onClick: () => { chooseSegment(turn, item.segment); }, "aria-current": selectedSegmentId === item.id ? 'true' : undefined, children: [_jsx("span", { children: t(LABEL_KEYS[item.segment.label]) }), _jsxs("small", { children: [t('step'), " ", stageStepRange(item.segment)] })] }, item.id)
                                                : _jsxs("button", { type: "button", className: css.gapButton, onClick: () => { chooseTurn(turn); setSelectedStepId(item.step.id); setFocusVersion(value => value + 1); }, children: [_jsxs("span", { children: [t('step'), " ", item.step.step] }), _jsx("small", { children: analysisLabel(item.step, t) })] }, item.id)) })] }, turn.id))] }), _jsx("div", { className: css.reader, ref: reader, children: !selectedTurn ? _jsx("p", { className: css.empty, children: t('emptySession') }) : _jsxs("div", { className: css.readerInner, children: [_jsxs("div", { className: css.readerHeader, children: [_jsxs("h3", { children: [t('turn'), " ", selectedTurn.turn, " \u00B7 ", turnStatus(selectedTurn, t)] }), _jsxs("span", { className: css.muted, children: [selectedTurn.steps.length, " ", t('steps'), " \u00B7 seq ", selectedTurn.startSeq, selectedTurn.endSeq !== undefined && `–${selectedTurn.endSeq}`] })] }), _jsxs("section", { className: css.request, children: [_jsx("h4", { children: t('request') }), _jsx("pre", { className: css.sourceText, children: requestText(selectedTurn.requests) || t('notProvided') }), _jsxs("details", { children: [_jsx("summary", { children: t('source') }), _jsx("pre", { className: css.sourceText, children: format(selectedTurn.requests) })] })] }), _jsxs("div", { className: css.readerHeading, children: [_jsx("h3", { children: t('source') }), _jsxs("label", { className: css.search, children: [t('search'), _jsx("input", { value: query, onChange: event => { setQuery(event.target.value); }, placeholder: t('search') })] }), query && _jsx("button", { type: "button", className: css.textButton, onClick: () => { setQuery(''); }, children: t('clearSearch') })] }), selectedTurn.steps.length === 0 ? _jsx("p", { className: css.empty, children: t('emptyTurn') }) : visibleSteps.length === 0 ? _jsx("p", { className: css.empty, children: t('emptySearch') }) : visibleSteps.map(step => _jsx(StepCard, { step: step, t: t, selected: selectedStepId === step.id, inSegment: segmentStepIds.has(step.id), onDetails: recordId => { void toggleDetails(step.id, recordId); }, detailsOpen: detailsTarget?.stepId === step.id && detailsTarget.recordId === undefined, previousDetailsOpen: detailsTarget?.stepId === step.id && detailsTarget.recordId !== undefined, detail: detailsTarget?.stepId === step.id ? detail : undefined, detailLoading: detailsTarget?.stepId === step.id && detailLoading, detailFailed: detailsTarget?.stepId === step.id && detailFailed }, step.id))] }) })] })] });
}
//# sourceMappingURL=StageNavigation.js.map