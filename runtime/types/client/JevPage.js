import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/** Jev bundle settings, feature catalogue, and bounded decision-record browser. */
import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button, SegmentedTabs, StateDot, Switch } from '@deepseek-ai/dsh-client-ui-primitives';
import { resolveConnectionIdentity } from "../types.js";
import css from './JevPage.module.css';
function featureName(feature, t) {
    if (feature.id === 'shared-findings')
        return t('sharedFindingsName');
    if (feature.id === 'stage-navigation')
        return t('stageNavigationName');
    return feature.name;
}
function featureDescription(feature, t) {
    if (feature.id === 'shared-findings')
        return t('sharedFindingsDescription');
    if (feature.id === 'stage-navigation')
        return t('stageNavigationDescription');
    return feature.description;
}
function recordFeatureName(features, featureId, t) {
    const feature = features.find(entry => entry.id === featureId);
    return feature ? featureName(feature, t) : featureId;
}
const STATUSES = ['pending', 'waiting', 'succeeded', 'failed', 'cancelled', 'interrupted'];
const PAGE_SIZE = 25;
function statusLabel(status, t) {
    return t(status);
}
function actionStatusLabel(status, t) {
    const key = {
        unconfirmed: 'unconfirmed', 'not-adopted': 'notAdopted', cancelled: 'cancelled', executed: 'executed',
        'execution-failed': 'executionFailed', observed: 'observed',
    };
    return t(key[status]);
}
function dateText(value) {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}
function JsonDetail({ value }) {
    return _jsx("pre", { className: css.code, children: JSON.stringify(value, null, 2) });
}
function DetailBlock({ label, value }) {
    if (value === undefined)
        return null;
    return _jsxs("div", { className: css.detailBlock, children: [_jsx("span", { className: css.detailLabel, children: label }), _jsx(JsonDetail, { value: value })] });
}
function Loading({ label }) {
    return _jsx("div", { className: css.loading, role: "status", "aria-label": label, children: _jsx(StateDot, { state: "ongoing", size: 24 }) });
}
/** Render one plugin-owned page inside the Host Plugins bundle detail. */
export function JevPage(props) {
    const [tab, setTab] = useState('settings');
    const t = props.t;
    if (props.view !== 'page')
        return null;
    return (_jsxs("div", { className: css.page, children: [_jsx(SegmentedTabs, { label: t('tabs'), items: [
                    { value: 'settings', label: t('settings'), id: 'jev-settings-tab', panelId: 'jev-settings-panel' },
                    { value: 'records', label: t('records'), id: 'jev-records-tab', panelId: 'jev-records-panel' },
                ], value: tab, onChange: setTab, className: css.tabs }), tab === 'settings'
                ? _jsxs("div", { id: "jev-settings-panel", role: "tabpanel", "aria-labelledby": "jev-settings-tab", className: css.panel, children: [_jsx(SettingsPanel, { form: props.form, jev: props.jev, notifySuccess: props.notifySuccess, t: t }), props.supervisionForm && _jsx(SupervisionSettings, { form: props.supervisionForm, notifySuccess: props.notifySuccess, t: t }), props.selectionForm && _jsx(SelectionSettings, { form: props.selectionForm, notifySuccess: props.notifySuccess, t: t }), props.outputAdmissionForm && _jsx(OutputAdmissionSettings, { form: props.outputAdmissionForm, notifySuccess: props.notifySuccess, t: t }), props.stageNavigationForm && _jsx(StageNavigationSettings, { form: props.stageNavigationForm, notifySuccess: props.notifySuccess, t: t })] })
                : _jsx("div", { id: "jev-records-panel", role: "tabpanel", "aria-labelledby": "jev-records-tab", children: _jsx(RecordsPanel, { jev: props.jev, t: t }) })] }));
}
const SELECTION_FIELDS = [
    { key: 'skillLimit', label: 'skillSummaryCount' },
    { key: 'fileCandidates', label: 'fileRankingMaximum' },
    { key: 'fileLimit', label: 'rankedPathCount' },
];
function parsePositiveInteger(value) {
    if (!/^[1-9]\d*$/.test(value))
        return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
}
const OUTPUT_FIELDS = [
    { key: 'generalMinChars', label: 'generalMinChars' }, { key: 'testMinChars', label: 'testMinChars' },
    { key: 'generalBlockChars', label: 'generalBlockChars' }, { key: 'maxGeneralBlocks', label: 'maxGeneralBlocks' },
    { key: 'maxTestCandidates', label: 'maxTestCandidates' }, { key: 'maxRequestChars', label: 'maxRequestChars' },
    { key: 'maxTaskChars', label: 'maxTaskChars' }, { key: 'waitMs', label: 'admissionWaitMs' },
    { key: 'omitProbability', label: 'omitProbability', ratio: true }, { key: 'minSavedChars', label: 'minSavedChars' },
    { key: 'minSavedRatio', label: 'minSavedRatio', ratio: true }, { key: 'slowTestMs', label: 'slowTestMs' },
    { key: 'duplicateMinLines', label: 'duplicateMinLines' }, { key: 'duplicateMinChars', label: 'duplicateMinChars' },
];
function OutputAdmissionSettings({ form, notifySuccess, t }) {
    const subscribe = useCallback((listener) => form.subscribe(listener), [form]);
    const getSnapshot = useCallback(() => form.getSnapshot(), [form]);
    const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    const [draft, setDraft] = useState({});
    const [invalid, setInvalid] = useState([]);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState(false);
    const edited = useRef(false);
    const observed = useRef('');
    useEffect(() => {
        if (snapshot.value === undefined)
            return;
        const values = Object.fromEntries(OUTPUT_FIELDS.map(({ key }) => [key, String(snapshot.value[key])]));
        const signature = JSON.stringify(values);
        if (signature === observed.current)
            return;
        observed.current = signature;
        if (!edited.current)
            setDraft(values);
    }, [snapshot.value]);
    const current = snapshot.value;
    const dirty = current !== undefined && OUTPUT_FIELDS.some(({ key }) => draft[key] !== undefined && draft[key] !== String(current[key]));
    useEffect(() => { if (!dirty)
        edited.current = false; }, [dirty]);
    const save = async () => {
        const errors = [];
        const values = {};
        for (const { key, ratio } of OUTPUT_FIELDS) {
            const raw = draft[key] ?? '';
            const value = ratio ? Number(raw) : parsePositiveInteger(raw);
            if (raw.trim() === '' || value === null || !Number.isFinite(value) || ratio && (value < 0 || value > 1))
                errors.push(key);
            else
                values[key] = value;
        }
        if (errors.length) {
            setInvalid(errors);
            return;
        }
        setSaving(true);
        setSaveError(false);
        try {
            const accepted = await form.mutate(OUTPUT_FIELDS.map(({ key }) => ({ op: 'set', path: [key], value: values[key] })), snapshot.revision);
            if (!accepted)
                setSaveError(true);
            else {
                edited.current = false;
                notifySuccess(t('outputAdmissionSaved'));
            }
        }
        catch {
            setSaveError(true);
        }
        finally {
            setSaving(false);
        }
    };
    return _jsxs("section", { className: css.section, "aria-label": t('outputAdmissionSettings'), children: [_jsx("h3", { className: css.heading, children: t('outputAdmissionSettings') }), _jsx("p", { className: css.hint, children: t('outputAdmissionHint') }), snapshot.status === 'loading' && current === undefined && _jsx(Loading, { label: t('loading') }), snapshot.status === 'unavailable' && _jsx("p", { className: css.notice, children: t('unavailable') }), current !== undefined && _jsxs("div", { className: css.form, children: [_jsx("div", { className: css.filters, children: OUTPUT_FIELDS.map(({ key, label, ratio }) => _jsxs("div", { className: css.field, children: [_jsx("label", { htmlFor: `jev-output-${key}`, children: t(label) }), _jsx("input", { id: `jev-output-${key}`, type: "number", min: ratio ? '0' : '1', max: ratio ? '1' : undefined, step: ratio ? 'any' : '1', value: draft[key] ?? String(current[key]), "aria-invalid": invalid.includes(key) || undefined, disabled: !snapshot.writable || saving, onChange: event => { edited.current = true; setDraft(previous => ({ ...previous, [key]: event.target.value })); setInvalid(previous => previous.filter(item => item !== key)); } }), invalid.includes(key) && _jsx("span", { role: "alert", className: css.notice, children: t('outputAdmissionInvalid') })] }, key)) }), _jsx("div", { className: css.actions, children: _jsx(Button, { variant: "primary", disabled: !snapshot.writable || saving || !dirty, onClick: () => { void save(); }, children: saving ? t('saving') : t('saveOutputAdmission') }) }), saveError && _jsx("p", { role: "alert", className: css.notice, children: t('outputAdmissionSaveFailed') })] })] });
}
const STAGE_FIELDS = [
    { key: 'previousSteps', label: 'previousSteps', min: 0, max: 20 },
    { key: 'previousChars', label: 'previousChars', min: 0, max: 100_000 },
    { key: 'maxRequestChars', label: 'stageMaxRequestChars', min: 2048, max: 10_000_000 },
    { key: 'concurrency', label: 'stageConcurrency', min: 1, max: 8 },
];
function StageNavigationSettings({ form, notifySuccess, t }) {
    const subscribe = useCallback((listener) => form.subscribe(listener), [form]);
    const getSnapshot = useCallback(() => form.getSnapshot(), [form]);
    const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    const [draft, setDraft] = useState({});
    const [invalid, setInvalid] = useState([]);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState(false);
    const edited = useRef(false);
    const observed = useRef('');
    useEffect(() => {
        if (snapshot.value === undefined)
            return;
        const values = {
            previousSteps: String(snapshot.value.previousSteps), previousChars: String(snapshot.value.previousChars),
            maxRequestChars: String(snapshot.value.maxRequestChars), concurrency: String(snapshot.value.concurrency),
        };
        const signature = JSON.stringify(values);
        if (signature === observed.current)
            return;
        observed.current = signature;
        if (!edited.current)
            setDraft(values);
    }, [snapshot.value]);
    const current = snapshot.value;
    const dirty = current !== undefined && STAGE_FIELDS.some(({ key }) => draft[key] !== undefined && draft[key] !== String(current[key]));
    useEffect(() => { if (!dirty)
        edited.current = false; }, [dirty]);
    const save = async () => {
        const errors = [];
        const values = {};
        for (const { key, min, max } of STAGE_FIELDS) {
            const raw = draft[key] ?? '';
            const value = Number(raw);
            if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max)
                errors.push(key);
            else
                values[key] = value;
        }
        if (errors.length > 0) {
            setInvalid(errors);
            return;
        }
        setSaving(true);
        setSaveError(false);
        try {
            const accepted = await form.mutate(STAGE_FIELDS.map(({ key }) => ({ op: 'set', path: [key], value: values[key] })), snapshot.revision);
            if (!accepted)
                setSaveError(true);
            else {
                edited.current = false;
                notifySuccess(t('stageSaved'));
            }
        }
        catch {
            setSaveError(true);
        }
        finally {
            setSaving(false);
        }
    };
    return _jsxs("section", { className: css.section, "aria-label": t('stageSettings'), children: [_jsx("h3", { className: css.heading, children: t('stageSettings') }), _jsx("p", { className: css.hint, children: t('stageSettingsHint') }), snapshot.status === 'loading' && current === undefined && _jsx(Loading, { label: t('loading') }), snapshot.status === 'unavailable' && _jsx("p", { className: css.notice, children: t('unavailable') }), current !== undefined && _jsxs("div", { className: css.form, children: [_jsx("div", { className: css.filters, children: STAGE_FIELDS.map(({ key, label, min, max }) => _jsxs("div", { className: css.field, children: [_jsx("label", { htmlFor: `jev-stage-${key}`, children: t(label) }), _jsx("input", { id: `jev-stage-${key}`, type: "number", min: min, max: max, step: "1", value: draft[key] ?? String(current[key]), "aria-invalid": invalid.includes(key) || undefined, disabled: !snapshot.writable || saving, onChange: event => { edited.current = true; setDraft(previous => ({ ...previous, [key]: event.target.value })); setInvalid(previous => previous.filter(item => item !== key)); } }), invalid.includes(key) && _jsx("span", { role: "alert", className: css.notice, children: t('stageInvalid') })] }, key)) }), _jsx("div", { className: css.actions, children: _jsx(Button, { variant: "primary", disabled: !snapshot.writable || saving || !dirty, onClick: () => { void save(); }, children: saving ? t('saving') : t('saveStageSettings') }) }), saveError && _jsx("p", { role: "alert", className: css.notice, children: t('stageSaveFailed') })] })] });
}
function SelectionSettings({ form, notifySuccess, t }) {
    const subscribe = useCallback((listener) => form.subscribe(listener), [form]);
    const getSnapshot = useCallback(() => form.getSnapshot(), [form]);
    const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    const [draft, setDraft] = useState({ skillLimit: '', fileCandidates: '', fileLimit: '' });
    const [errors, setErrors] = useState({});
    const [saveError, setSaveError] = useState(false);
    const [saving, setSaving] = useState(false);
    const [hydrated, setHydrated] = useState(false);
    const edited = useRef(false);
    const observed = useRef('');
    useEffect(() => {
        if (snapshot.value === undefined)
            return;
        const next = {
            skillLimit: String(snapshot.value.skillLimit),
            fileCandidates: String(snapshot.value.fileCandidates),
            fileLimit: String(snapshot.value.fileLimit),
        };
        const signature = JSON.stringify(next);
        if (signature === observed.current)
            return;
        observed.current = signature;
        if (!edited.current)
            setDraft(next);
        setHydrated(true);
    }, [snapshot.value]);
    const current = snapshot.value;
    const dirty = hydrated && current !== undefined && SELECTION_FIELDS.some(({ key }) => draft[key] !== String(current[key]));
    useEffect(() => { if (!dirty)
        edited.current = false; }, [dirty]);
    const edit = (key, value) => {
        edited.current = true;
        setDraft(previous => ({ ...previous, [key]: value }));
        setErrors(previous => ({ ...previous, [key]: false }));
        setSaveError(false);
    };
    const save = async () => {
        const parsed = {};
        const nextErrors = {};
        for (const { key } of SELECTION_FIELDS) {
            const value = parsePositiveInteger(draft[key]);
            if (value === null)
                nextErrors[key] = true;
            else
                parsed[key] = value;
        }
        if (Object.keys(nextErrors).length > 0) {
            setErrors(nextErrors);
            return;
        }
        setSaving(true);
        setSaveError(false);
        try {
            const accepted = await form.mutate(SELECTION_FIELDS.map(({ key }) => ({ op: 'set', path: [key], value: parsed[key] })), snapshot.revision);
            if (accepted) {
                const saved = form.getSnapshot().value;
                if (saved !== undefined) {
                    setDraft({ skillLimit: String(saved.skillLimit), fileCandidates: String(saved.fileCandidates), fileLimit: String(saved.fileLimit) });
                    edited.current = false;
                }
                notifySuccess(t('selectionCountSaved'));
            }
            else
                setSaveError(true);
        }
        catch {
            setSaveError(true);
        }
        finally {
            setSaving(false);
        }
    };
    return _jsxs("section", { className: css.section, "aria-label": t('selectionCounts'), children: [_jsx("h3", { className: css.heading, children: t('selectionCounts') }), _jsx("p", { className: css.hint, children: t('selectionCountsHint') }), snapshot.status === 'loading' && current === undefined && _jsx(Loading, { label: t('loading') }), snapshot.status === 'unavailable' && _jsx("p", { className: css.notice, children: t('unavailable') }), current !== undefined && _jsxs("div", { className: css.form, children: [_jsx("div", { className: css.filters, children: SELECTION_FIELDS.map(({ key, label }) => _jsxs("div", { className: css.field, children: [_jsx("label", { htmlFor: `jev-selection-${key}`, children: t(label) }), _jsx("input", { id: `jev-selection-${key}`, type: "text", inputMode: "numeric", value: draft[key], "aria-invalid": errors[key] || undefined, "aria-describedby": errors[key] ? `jev-selection-${key}-error` : undefined, disabled: !snapshot.writable || saving, onChange: event => { edit(key, event.target.value); } }), errors[key] && _jsx("span", { id: `jev-selection-${key}-error`, role: "alert", className: css.notice, children: t('selectionCountInvalid') })] }, key)) }), _jsxs("div", { className: css.actions, children: [_jsx(Button, { variant: "primary", disabled: !snapshot.writable || saving || !dirty, onClick: () => { void save(); }, children: saving ? t('saving') : t('saveSelectionCounts') }), !snapshot.writable && _jsx("span", { className: css.hint, children: t('readOnly') })] }), saveError && _jsx("p", { role: "alert", className: css.notice, children: t('selectionCountSaveFailed') })] })] });
}
const SUPERVISION_FIELDS = [
    { key: 'driftInterval', label: 'driftInterval' },
    { key: 'noProgressRounds', label: 'noProgressRounds' },
    { key: 'evidenceChars', label: 'evidenceChars' },
];
function SupervisionSettings({ form, notifySuccess, t }) {
    const subscribe = useCallback((listener) => form.subscribe(listener), [form]);
    const getSnapshot = useCallback(() => form.getSnapshot(), [form]);
    const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    const [draft, setDraft] = useState({ driftInterval: '', noProgressRounds: '', evidenceChars: '' });
    const [errors, setErrors] = useState({});
    const [saveError, setSaveError] = useState(false);
    const [saving, setSaving] = useState(false);
    const [hydrated, setHydrated] = useState(false);
    const edited = useRef(false);
    const observed = useRef('');
    useEffect(() => {
        if (snapshot.value === undefined)
            return;
        const next = {
            driftInterval: String(snapshot.value.driftInterval),
            noProgressRounds: String(snapshot.value.noProgressRounds),
            evidenceChars: String(snapshot.value.evidenceChars),
        };
        const signature = JSON.stringify(next);
        if (signature === observed.current)
            return;
        observed.current = signature;
        if (!edited.current)
            setDraft(next);
        setHydrated(true);
    }, [snapshot.value]);
    const current = snapshot.value;
    const dirty = hydrated && current !== undefined && SUPERVISION_FIELDS.some(({ key }) => draft[key] !== String(current[key]));
    useEffect(() => { if (!dirty)
        edited.current = false; }, [dirty]);
    const edit = (key, value) => {
        edited.current = true;
        setDraft(previous => ({ ...previous, [key]: value }));
        setErrors(previous => ({ ...previous, [key]: false }));
        setSaveError(false);
    };
    const save = async () => {
        const parsed = {};
        const nextErrors = {};
        for (const { key } of SUPERVISION_FIELDS) {
            const value = parsePositiveInteger(draft[key]);
            if (value === null)
                nextErrors[key] = true;
            else
                parsed[key] = value;
        }
        if (Object.keys(nextErrors).length > 0) {
            setErrors(nextErrors);
            return;
        }
        setSaving(true);
        setSaveError(false);
        try {
            const accepted = await form.mutate(SUPERVISION_FIELDS.map(({ key }) => ({ op: 'set', path: [key], value: parsed[key] })), snapshot.revision);
            if (accepted) {
                const saved = form.getSnapshot().value;
                if (saved !== undefined) {
                    setDraft({ driftInterval: String(saved.driftInterval), noProgressRounds: String(saved.noProgressRounds), evidenceChars: String(saved.evidenceChars) });
                    edited.current = false;
                }
                notifySuccess(t('supervisionCountSaved'));
            }
            else
                setSaveError(true);
        }
        catch {
            setSaveError(true);
        }
        finally {
            setSaving(false);
        }
    };
    return _jsxs("section", { className: css.section, "aria-label": t('supervisionCounts'), children: [_jsx("h3", { className: css.heading, children: t('supervisionCounts') }), _jsx("p", { className: css.hint, children: t('supervisionCountsHint') }), snapshot.status === 'loading' && current === undefined && _jsx(Loading, { label: t('loading') }), snapshot.status === 'unavailable' && _jsx("p", { className: css.notice, children: t('unavailable') }), current !== undefined && _jsxs("div", { className: css.form, children: [_jsx("div", { className: css.filters, children: SUPERVISION_FIELDS.map(({ key, label }) => _jsxs("div", { className: css.field, children: [_jsx("label", { htmlFor: `jev-supervision-${key}`, children: t(label) }), _jsx("input", { id: `jev-supervision-${key}`, type: "text", inputMode: "numeric", value: draft[key], "aria-invalid": errors[key] || undefined, "aria-describedby": errors[key] ? `jev-supervision-${key}-error` : undefined, disabled: !snapshot.writable || saving, onChange: event => { edit(key, event.target.value); } }), errors[key] && _jsx("span", { id: `jev-supervision-${key}-error`, role: "alert", className: css.notice, children: t('supervisionCountInvalid') })] }, key)) }), _jsxs("div", { className: css.actions, children: [_jsx(Button, { variant: "primary", disabled: !snapshot.writable || saving || !dirty, onClick: () => { void save(); }, children: saving ? t('saving') : t('saveSupervisionCounts') }), !snapshot.writable && _jsx("span", { className: css.hint, children: t('readOnly') })] }), saveError && _jsx("p", { role: "alert", className: css.notice, children: t('supervisionCountSaveFailed') })] })] });
}
function connectionDraft(value) {
    return {
        baseUrl: value.baseUrl, model: value.model, credentialRef: value.credentialRef,
        timeoutMs: String(value.timeoutMs), judgmentModel: value.judgmentModel ?? 'jev', lunaApi: value.lunaApi ?? 'openrouter',
        lunaOpenRouterBaseUrl: value.lunaOpenRouterBaseUrl ?? 'https://openrouter.ai/api/alpha/decisions',
        lunaOpenRouterCredentialRef: value.lunaOpenRouterCredentialRef ?? 'JEV_LUNA_OPENROUTER_API_KEY',
        lunaOpenAIBaseUrl: value.lunaOpenAIBaseUrl ?? 'https://api.openai.com/v1/decisions',
        lunaOpenAICredentialRef: value.lunaOpenAICredentialRef ?? 'JEV_LUNA_OPENAI_API_KEY',
    };
}
const EMPTY_DRAFT = connectionDraft({ baseUrl: '', model: 'jev-latest', credentialRef: 'JEV_API_KEY', timeoutMs: 10000, features: {},
    judgmentModel: 'jev', lunaApi: 'openrouter', lunaOpenRouterBaseUrl: 'https://openrouter.ai/api/alpha/decisions',
    lunaOpenRouterCredentialRef: 'JEV_LUNA_OPENROUTER_API_KEY', lunaOpenAIBaseUrl: 'https://api.openai.com/v1/decisions',
    lunaOpenAICredentialRef: 'JEV_LUNA_OPENAI_API_KEY' });
function identityKey(connection) {
    return JSON.stringify([connection.connectionId, connection.baseUrl, connection.model, connection.credentialRef, connection.timeoutMs]);
}
function SettingsPanel({ form, jev, notifySuccess, t }) {
    const subscribe = useCallback((listener) => form.subscribe(listener), [form]);
    const getSnapshot = useCallback(() => form.getSnapshot(), [form]);
    const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    const [draft, setDraft] = useState(EMPTY_DRAFT);
    const editedConnection = useRef(new Set());
    const observedConnection = useRef('');
    const draftRef = useRef(draft);
    draftRef.current = draft;
    const [features, setFeatures] = useState([]);
    const [featureLoading, setFeatureLoading] = useState(true);
    const [featureError, setFeatureError] = useState('');
    const [featureErrorLabel, setFeatureErrorLabel] = useState('featureLoadFailed');
    const [saving, setSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState('');
    const [featureBusy, setFeatureBusy] = useState('');
    const [credential, setCredential] = useState(null);
    const [credentialMessage, setCredentialMessage] = useState('');
    const [secret, setSecret] = useState('');
    const [secretSaving, setSecretSaving] = useState(false);
    const [probe, setProbe] = useState(null);
    const [probeError, setProbeError] = useState('');
    const [testing, setTesting] = useState(false);
    const probeAbort = useRef(null);
    const alive = useRef(true);
    const saveGeneration = useRef(0);
    const credentialGeneration = useRef(0);
    const keyGeneration = useRef(0);
    const probeGeneration = useRef(0);
    useEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false;
            saveGeneration.current++;
            credentialGeneration.current++;
            keyGeneration.current++;
            probeGeneration.current++;
            probeAbort.current?.abort();
        };
    }, [form, jev]);
    useEffect(() => {
        if (snapshot.value === undefined)
            return;
        const next = connectionDraft(snapshot.value);
        const signature = JSON.stringify(next);
        if (signature === observedConnection.current)
            return;
        observedConnection.current = signature;
        setDraft(previous => {
            const merged = { ...next };
            for (const field of editedConnection.current)
                Object.assign(merged, { [field]: previous[field] });
            return merged;
        });
    }, [snapshot.value]);
    const current = snapshot.value;
    const dirty = current !== undefined && JSON.stringify(draft) !== JSON.stringify(connectionDraft(current));
    useEffect(() => { if (!dirty)
        editedConnection.current.clear(); }, [dirty]);
    const draftValues = { ...draft, timeoutMs: Number(draft.timeoutMs), features: current?.features ?? {} };
    const displayedConnection = resolveConnectionIdentity(draftValues);
    const savedConnection = current === undefined ? undefined : resolveConnectionIdentity({ ...current, ...connectionDraft(current), timeoutMs: current.timeoutMs });
    const contextKey = JSON.stringify({ draft, savedConnection, dirty, status: snapshot.status });
    const contextRef = useRef(contextKey);
    contextRef.current = contextKey;
    const loadFeatures = useCallback(async () => {
        setFeatureLoading(true);
        setFeatureError('');
        try {
            const next = await jev.listFeatures();
            if (alive.current)
                setFeatures(next);
        }
        catch {
            if (alive.current) {
                setFeatureErrorLabel('featureLoadFailed');
                setFeatureError(t('featureLoadFailed'));
            }
        }
        finally {
            if (alive.current)
                setFeatureLoading(false);
        }
    }, [jev, t]);
    useEffect(() => { void loadFeatures(); }, [loadFeatures]);
    // A completion can update only the exact saved connection still shown by this form.
    useEffect(() => {
        const generation = ++credentialGeneration.current;
        keyGeneration.current++;
        probeGeneration.current++;
        probeAbort.current?.abort();
        probeAbort.current = null;
        setCredential(null);
        setCredentialMessage('');
        setSecret('');
        setSecretSaving(false);
        setProbe(null);
        setProbeError('');
        setTesting(false);
        if (dirty || savedConnection === undefined || snapshot.status !== 'ready')
            return;
        const connection = savedConnection;
        void jev.getCredentialStatus(connection).then(result => {
            if (!alive.current || generation !== credentialGeneration.current || contextRef.current !== contextKey)
                return;
            if (identityKey(result.connection) !== identityKey(connection)) {
                setCredentialMessage(t('connectionChanged'));
                return;
            }
            setCredential(result);
        }, () => {
            if (alive.current && generation === credentialGeneration.current && contextRef.current === contextKey)
                setCredentialMessage(t('unavailable'));
        });
    }, [contextKey, form, jev, t]);
    const editConnection = (field, value) => {
        editedConnection.current.add(field);
        setSaveMessage('');
        setDraft(previous => ({ ...previous, [field]: value }));
    };
    const saveConnection = async () => {
        const submission = { ...draft, baseUrl: draft.baseUrl.trim(), model: draft.model.trim(), credentialRef: draft.credentialRef.trim(),
            lunaOpenRouterBaseUrl: draft.lunaOpenRouterBaseUrl.trim(), lunaOpenRouterCredentialRef: draft.lunaOpenRouterCredentialRef.trim(),
            lunaOpenAIBaseUrl: draft.lunaOpenAIBaseUrl.trim(), lunaOpenAICredentialRef: draft.lunaOpenAICredentialRef.trim() };
        const timeoutMs = Number(draft.timeoutMs);
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000) {
            setSaveMessage(t('invalidTimeout'));
            return;
        }
        const generation = ++saveGeneration.current;
        const submittedDraft = JSON.stringify(draft);
        setSaving(true);
        setSaveMessage('');
        try {
            const values = { ...submission, timeoutMs };
            const accepted = await form.mutate(Object.entries(values).map(([key, value]) => ({ op: 'set', path: [key], value })), snapshot.revision);
            if (!alive.current || generation !== saveGeneration.current || JSON.stringify(draftRef.current) !== submittedDraft)
                return;
            if (!accepted) {
                setSaveMessage(t('saveFailed'));
                return;
            }
            const saved = form.getSnapshot().value;
            if (saved === undefined || JSON.stringify(connectionDraft(saved)) !== JSON.stringify({ ...submission, timeoutMs: String(timeoutMs) })) {
                setSaveMessage(t('connectionChanged'));
                return;
            }
            editedConnection.current.clear();
            setDraft(connectionDraft(saved));
            notifySuccess(t('saveSuccess'));
        }
        catch {
            if (alive.current && generation === saveGeneration.current)
                setSaveMessage(t('saveFailed'));
        }
        finally {
            if (alive.current && generation === saveGeneration.current)
                setSaving(false);
        }
    };
    const saveKey = async () => {
        if (!secret || dirty || savedConnection === undefined || !credential?.writable)
            return;
        const connection = savedConnection;
        const capturedContext = contextKey;
        const generation = ++keyGeneration.current;
        setSecretSaving(true);
        setCredentialMessage('');
        try {
            const result = await jev.setCredential(connection, secret);
            if (!alive.current || generation !== keyGeneration.current || contextRef.current !== capturedContext)
                return;
            if (identityKey(result.connection) !== identityKey(connection)) {
                setCredentialMessage(t('connectionChanged'));
                return;
            }
            credentialGeneration.current++;
            setCredential(result);
            setSecret('');
            notifySuccess(t('keySaved'));
        }
        catch {
            if (alive.current && generation === keyGeneration.current && contextRef.current === capturedContext)
                setCredentialMessage(t('keySaveFailed'));
        }
        finally {
            if (alive.current && generation === keyGeneration.current && contextRef.current === capturedContext)
                setSecretSaving(false);
        }
    };
    const runProbe = async () => {
        if (dirty || savedConnection === undefined || snapshot.status !== 'ready')
            return;
        const connection = savedConnection;
        const capturedContext = contextKey;
        const generation = ++probeGeneration.current;
        const controller = new AbortController();
        probeAbort.current = controller;
        setTesting(true);
        setProbe(null);
        setProbeError('');
        try {
            const result = await jev.testConnection(connection, controller.signal);
            if (!alive.current || generation !== probeGeneration.current || contextRef.current !== capturedContext || controller.signal.aborted)
                return;
            if (identityKey(result.connection) !== identityKey(connection)) {
                setProbeError(t('connectionChanged'));
                return;
            }
            setProbe(result);
        }
        catch {
            if (alive.current && generation === probeGeneration.current && contextRef.current === capturedContext && !controller.signal.aborted)
                setProbeError(t('testFailed'));
        }
        finally {
            if (probeAbort.current === controller)
                probeAbort.current = null;
            if (alive.current && generation === probeGeneration.current && contextRef.current === capturedContext)
                setTesting(false);
        }
    };
    const toggleFeature = async (id, enabled) => {
        setFeatureBusy(id);
        setFeatureError('');
        try {
            const accepted = await form.mutate([{ op: 'set', path: ['features', id], value: enabled }], snapshot.revision);
            if (!accepted && alive.current) {
                setFeatureErrorLabel('featureSaveFailed');
                setFeatureError(t('featureSaveFailed'));
            }
        }
        catch {
            if (alive.current) {
                setFeatureErrorLabel('featureSaveFailed');
                setFeatureError(t('featureSaveFailed'));
            }
        }
        finally {
            if (alive.current)
                setFeatureBusy('');
        }
    };
    const endpointField = draft.judgmentModel === 'jev' ? 'baseUrl' : draft.lunaApi === 'openrouter' ? 'lunaOpenRouterBaseUrl' : 'lunaOpenAIBaseUrl';
    const referenceField = draft.judgmentModel === 'jev' ? 'credentialRef' : draft.lunaApi === 'openrouter' ? 'lunaOpenRouterCredentialRef' : 'lunaOpenAICredentialRef';
    return (_jsxs("div", { className: css.panel, children: [_jsxs("section", { className: css.section, "aria-label": t('connection'), children: [_jsx("h3", { className: css.heading, children: t('connection') }), _jsx("p", { className: css.hint, children: t('connectionHint') }), snapshot.status === 'loading' && current === undefined && _jsx(Loading, { label: t('loading') }), snapshot.status === 'unavailable' && _jsx("p", { className: css.notice, children: t('unavailable') }), current !== undefined && _jsxs("div", { className: css.form, children: [_jsxs("div", { className: css.filters, children: [_jsxs("label", { className: css.field, children: [_jsx("span", { children: t('decisionModel') }), _jsxs("select", { value: draft.judgmentModel, disabled: !snapshot.writable || saving, onChange: event => { editConnection('judgmentModel', event.target.value); }, children: [_jsx("option", { value: "jev", children: t('jevModel') }), _jsx("option", { value: "luna", children: t('lunaModel') })] })] }), draft.judgmentModel === 'luna' && _jsxs("label", { className: css.field, children: [_jsx("span", { children: t('lunaApi') }), _jsxs("select", { value: draft.lunaApi, disabled: !snapshot.writable || saving, onChange: event => { editConnection('lunaApi', event.target.value); }, children: [_jsx("option", { value: "openrouter", children: t('openRouter') }), _jsx("option", { value: "openai", children: t('openAI') })] })] })] }), _jsxs("div", { className: css.filters, children: [_jsxs("label", { className: css.field, children: [_jsx("span", { children: t('baseUrl') }), _jsx("input", { value: draft[endpointField], disabled: !snapshot.writable || saving, onChange: event => { editConnection(endpointField, event.target.value); } })] }), _jsxs("label", { className: css.field, children: [_jsx("span", { children: t('model') }), _jsx("input", { "aria-label": t('model'), "aria-describedby": draft.judgmentModel === 'luna' ? 'jev-luna-model-hint' : undefined, value: draft.judgmentModel === 'jev' ? draft.model : displayedConnection.model, readOnly: draft.judgmentModel === 'luna', disabled: !snapshot.writable || saving, onChange: event => { if (draft.judgmentModel === 'jev')
                                                    editConnection('model', event.target.value); } }), draft.judgmentModel === 'luna' && _jsx("span", { id: "jev-luna-model-hint", className: css.hint, children: t('lunaModelHint') })] }), _jsxs("label", { className: css.field, children: [_jsx("span", { children: t('credentialRef') }), _jsx("input", { value: draft[referenceField], disabled: !snapshot.writable || saving, onChange: event => { editConnection(referenceField, event.target.value); } })] }), _jsxs("label", { className: css.field, children: [_jsx("span", { children: t('timeoutMs') }), _jsx("input", { type: "number", min: "1", max: "300000", step: "1", value: draft.timeoutMs, disabled: !snapshot.writable || saving, onChange: event => { editConnection('timeoutMs', event.target.value); } })] })] }), _jsxs("div", { className: css.actions, children: [_jsx(Button, { variant: "primary", disabled: !snapshot.writable || saving || !dirty, onClick: () => { void saveConnection(); }, children: saving ? t('saving') : t('saveConnection') }), !snapshot.writable && _jsx("span", { className: css.hint, children: t('readOnly') })] }), saveMessage && _jsx("p", { role: "status", className: css.notice, children: saveMessage })] }), _jsxs("div", { className: css.form, children: [_jsxs("label", { className: css.field, children: [_jsxs("span", { children: [t('apiKey'), credential !== null ? ` · ${credential.configured ? t('configured') : t('missing')}${!credential.writable ? ` · ${t('readOnly')}` : ''}` : ''] }), _jsx("input", { "aria-label": t('apiKey'), "aria-describedby": "jev-api-key-hint", type: "password", autoComplete: "new-password", value: secret, disabled: !credential?.writable || secretSaving || dirty, onChange: event => { setSecret(event.target.value); } }), _jsx("span", { id: "jev-api-key-hint", className: css.hint, children: t('apiKeyHint') })] }), _jsxs("div", { className: css.actions, children: [_jsx(Button, { disabled: !secret || !credential?.writable || secretSaving || dirty, onClick: () => { void saveKey(); }, children: secretSaving ? t('saving') : credential?.configured ? t('replaceKey') : t('saveKey') }), _jsx(Button, { disabled: testing || dirty || snapshot.status !== 'ready', onClick: () => { void runProbe(); }, children: testing ? t('testing') : t('testConnection') })] }), _jsx("p", { className: css.hint, children: t('diagnosticHint') }), dirty && _jsx("p", { className: css.hint, children: t('saveFirst') }), credentialMessage && _jsx("p", { role: "status", className: css.notice, children: credentialMessage }), probe && _jsxs("p", { role: "status", className: probe.ok ? css.success : css.notice, children: [t(probe.ok ? 'testSucceeded' : 'testFailed'), " \u00B7 ", t('latency'), ": ", probe.latencyMs, " ms", probe.failure ? ` · ${probe.failure.code}: ${probe.failure.message}` : ''] }), probeError && _jsx("p", { role: "alert", className: css.notice, children: probeError })] })] }), _jsxs("section", { className: css.section, "aria-label": t('features'), children: [_jsxs("div", { className: css.recordHead, children: [_jsx("h3", { className: css.heading, children: t('features') }), _jsx(Button, { size: "sm", disabled: featureLoading, onClick: () => { void loadFeatures(); }, children: t('refreshFeatures') })] }), featureLoading && features.length === 0 && current !== undefined && _jsx(Loading, { label: t('loading') }), featureError && _jsxs("p", { role: "alert", className: css.notice, children: [featureError, " ", featureErrorLabel === 'featureLoadFailed' && _jsx(Button, { size: "sm", onClick: () => { void loadFeatures(); }, children: t('retry') })] }), !featureLoading && !featureError && features.length === 0 && _jsx("p", { className: css.empty, children: t('noFeatures') }), _jsx("div", { className: css.list, children: features.map(feature => {
                            const enabled = current?.features?.[feature.id] ?? feature.enabled;
                            return _jsxs("div", { className: css.feature, children: [_jsxs("div", { className: css.featureBody, children: [_jsx("span", { className: css.featureTitle, children: featureName(feature, t) }), _jsx("span", { className: css.description, children: featureDescription(feature, t) }), feature.settingsDescription && _jsx("span", { className: css.hint, children: feature.settingsDescription })] }), _jsx(Switch, { checked: enabled, label: `${enabled ? t('disable') : t('enable')} ${featureName(feature, t)}`, disabled: !snapshot.writable || featureBusy !== '', onChange: next => { void toggleFeature(feature.id, next); } })] }, feature.id);
                        }) })] })] }));
}
function RecordsPanel({ jev, t }) {
    const [features, setFeatures] = useState([]);
    const [featureId, setFeatureId] = useState('');
    const [status, setStatus] = useState('');
    const [sessionId, setSessionId] = useState('');
    const [filter, setFilter] = useState({ limit: PAGE_SIZE });
    const [items, setItems] = useState([]);
    const [nextCursor, setNextCursor] = useState();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [selected, setSelected] = useState('');
    const [detail, setDetail] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailError, setDetailError] = useState('');
    const queryGeneration = useRef(0);
    const detailGeneration = useRef(0);
    const query = useCallback(async (nextFilter, append) => {
        const generation = ++queryGeneration.current;
        setLoading(true);
        setError('');
        try {
            const page = await jev.listRecords(nextFilter);
            if (generation !== queryGeneration.current)
                return;
            setItems(previous => append ? [...previous, ...page.items] : page.items);
            setNextCursor(page.nextCursor);
        }
        catch {
            if (generation === queryGeneration.current)
                setError(t('recordsFailed'));
        }
        finally {
            if (generation === queryGeneration.current)
                setLoading(false);
        }
    }, [jev, t]);
    useEffect(() => {
        void query({ limit: PAGE_SIZE }, false);
        void jev.listFeatures().then(setFeatures, () => { });
        return () => { queryGeneration.current++; detailGeneration.current++; };
    }, [jev, query]);
    const applyFilters = () => {
        detailGeneration.current++;
        const next = { limit: PAGE_SIZE };
        if (featureId)
            next.featureId = featureId;
        if (status)
            next.status = status;
        if (sessionId.trim())
            next.sessionId = sessionId.trim();
        setFilter(next);
        setSelected('');
        setDetail(null);
        void query(next, false);
    };
    const openDetail = async (id) => {
        const generation = ++detailGeneration.current;
        setSelected(id);
        setDetailLoading(true);
        setDetailError('');
        if (detail?.id !== id)
            setDetail(null);
        try {
            const result = await jev.getRecord(id);
            if (generation === detailGeneration.current)
                setDetail(result);
        }
        catch {
            if (generation === detailGeneration.current)
                setDetailError(t('detailFailed'));
        }
        finally {
            if (generation === detailGeneration.current)
                setDetailLoading(false);
        }
    };
    const closeDetail = () => { detailGeneration.current++; setSelected(''); setDetail(null); setDetailError(''); setDetailLoading(false); };
    return _jsxs("div", { className: css.panel, children: [_jsxs("section", { className: css.section, "aria-label": t('records'), children: [_jsxs("div", { className: css.filters, children: [_jsxs("label", { className: css.field, children: [_jsx("span", { children: t('feature') }), _jsx("input", { list: "jev-feature-suggestions", placeholder: t('allFeatures'), value: featureId, onChange: event => { setFeatureId(event.target.value); } }), _jsx("datalist", { id: "jev-feature-suggestions", children: features.map(feature => _jsx("option", { value: feature.id, label: featureName(feature, t) }, feature.id)) })] }), _jsxs("label", { className: css.field, children: [_jsx("span", { children: t('status') }), _jsxs("select", { value: status, onChange: event => { setStatus(event.target.value); }, children: [_jsx("option", { value: "", children: t('allStatuses') }), STATUSES.map(value => _jsx("option", { value: value, children: statusLabel(value, t) }, value))] })] }), _jsxs("label", { className: css.field, children: [_jsx("span", { children: t('sessionId') }), _jsx("input", { value: sessionId, onChange: event => { setSessionId(event.target.value); } })] })] }), _jsxs("div", { className: css.actions, children: [_jsx(Button, { variant: "primary", onClick: applyFilters, disabled: loading, children: t('applyFilters') }), _jsx(Button, { onClick: () => { void query(filter, false); }, disabled: loading, children: t('refresh') })] }), error && _jsxs("p", { role: "alert", className: css.notice, children: [error, " ", _jsx(Button, { size: "sm", onClick: () => { void query(filter, false); }, children: t('retry') })] }), loading && items.length === 0 && _jsx(Loading, { label: t('loading') }), !loading && !error && items.length === 0 && _jsx("p", { className: css.empty, children: t('noRecords') }), _jsx("div", { className: css.list, children: items.map(item => _jsxs("article", { className: css.record, children: [_jsxs("div", { className: css.recordHead, children: [_jsx("span", { className: css.featureTitle, children: item.diagnostic ? t('diagnostic') : recordFeatureName(features, item.featureId, t) }), _jsx("span", { className: css.meta, children: statusLabel(item.status, t) })] }), _jsxs("span", { className: css.meta, children: [t('time'), ": ", dateText(item.startedAt), " \u00B7 ", t('attempts'), ": ", item.attempts, item.sessionId ? ` · ${t('sessionId')}: ${item.sessionId}` : ''] }), _jsx("div", { children: _jsx(Button, { size: "sm", onClick: () => { void openDetail(item.id); }, children: t('details') }) })] }, item.id)) }), nextCursor && _jsx("div", { className: css.actions, children: _jsx(Button, { disabled: loading, onClick: () => { void query({ ...filter, cursor: nextCursor }, true); }, children: loading ? t('loading') : t('loadMore') }) })] }), selected && _jsxs("section", { className: css.section, "aria-label": t('details'), children: [_jsxs("div", { className: css.recordHead, children: [_jsx("h3", { className: css.heading, children: t('details') }), _jsx(Button, { size: "sm", onClick: closeDetail, children: t('closeDetails') })] }), detailError && _jsxs("p", { role: "alert", className: css.notice, children: [detailError, " ", _jsx(Button, { size: "sm", onClick: () => { void openDetail(selected); }, children: t('retry') })] }), detailLoading && !detail && _jsx(Loading, { label: t('loading') }), !detailLoading && !detailError && !detail && _jsx("p", { className: css.empty, children: t('noDetail') }), detail && _jsxs("div", { className: css.detail, children: [_jsxs("div", { className: css.meta, children: [t('operation'), ": ", detail.id, " \u00B7 ", t('status'), ": ", statusLabel(detail.status, t)] }), _jsx(DetailBlock, { label: t('operation'), value: detail.link }), _jsx(DetailBlock, { label: t('failure'), value: detail.failure }), _jsx("h4", { className: css.heading, children: t('attempts') }), detail.attemptRecords.map((attempt, index) => _jsxs("div", { className: css.record, children: [_jsxs("div", { className: css.meta, children: ["#", index + 1, " \u00B7 ", dateText(attempt.startedAt), " \u00B7 ", statusLabel(attempt.status, t), attempt.latencyMs !== undefined ? ` · ${t('latency')}: ${attempt.latencyMs} ms` : ''] }), _jsx(DetailBlock, { label: t('connectionIdentity'), value: attempt.connection }), _jsx(DetailBlock, { label: t('input'), value: attempt.request.state }), _jsx(DetailBlock, { label: t('questions'), value: attempt.request.questions }), _jsx(DetailBlock, { label: t('rawAnswer'), value: attempt.rawResponse }), _jsx(DetailBlock, { label: t('answer'), value: attempt.response }), _jsx(DetailBlock, { label: t('interpretation'), value: attempt.interpretation }), _jsx(DetailBlock, { label: t('failure'), value: attempt.failure }), _jsx(DetailBlock, { label: t('usage'), value: attempt.usage }), attempt.usageComplete === false && _jsx("p", { className: css.hint, children: t('usageIncomplete') }), attempt.networkRecords !== undefined && _jsxs("div", { className: css.detail, children: [_jsx("h4", { className: css.heading, children: t('providerRequests') }), attempt.networkRecords.map(packet => _jsxs("div", { className: css.record, children: [_jsxs("span", { className: css.meta, children: [packet.id, " \u00B7 ", statusLabel(packet.status, t), packet.httpStatus !== undefined ? ` · HTTP ${packet.httpStatus}` : ''] }), _jsx(DetailBlock, { label: t('questionIds'), value: packet.questionIds }), _jsx(DetailBlock, { label: t('requestBody'), value: packet.requestBody }), _jsx(DetailBlock, { label: t('reportedModel'), value: packet.returnedModel }), _jsx(DetailBlock, { label: t('requestId'), value: packet.requestId }), packet.rawResponseText !== undefined && _jsxs("div", { className: css.detailBlock, children: [_jsx("span", { className: css.detailLabel, children: t('rawAnswer') }), _jsx("pre", { className: css.code, children: packet.rawResponseText })] }), packet.rawResponseText === undefined && _jsx(DetailBlock, { label: t('rawAnswer'), value: packet.rawResponse }), _jsx(DetailBlock, { label: t('usage'), value: packet.usage }), _jsx(DetailBlock, { label: t('failure'), value: packet.failure })] }, packet.id))] })] }, attempt.id)), _jsx("h4", { className: css.heading, children: t('receipts') }), detail.receipts.length === 0 ? _jsx("p", { className: css.empty, children: t('noDetail') }) : detail.receipts.map(receipt => _jsxs("div", { className: css.record, children: [_jsxs("span", { className: css.meta, children: [dateText(receipt.at), " \u00B7 ", actionStatusLabel(receipt.status, t)] }), _jsx(DetailBlock, { label: t('actualAction'), value: receipt.reason ?? receipt.id })] }, receipt.id))] })] })] });
}
//# sourceMappingURL=JevPage.js.map