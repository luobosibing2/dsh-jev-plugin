/** Jev bundle settings, feature catalogue, and bounded decision-record browser. */

import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button, SegmentedTabs, StateDot, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SupervisionConfigValues } from '../supervision-types.ts'
import type { SelectionConfigValues } from '../selection-types.ts'
import type { OutputAdmissionConfigValues } from '../output-admission-types.ts'
import type { StageNavigationConfigValues } from '../stage-types.ts'
import type {
  JevActionStatus, JevConfigValues, JevConnectionIdentity, JevCredentialStatus, JevFeatureView, JevProbeResult, JevRecordDetail,
  JevRecordFilter, JevRecordPage, JevRecordStatus, JevRecordSummary,
} from '../types.ts'
import { resolveConnectionIdentity } from '../types.ts'
import type { JevLocaleKey } from './locales.ts'
import css from './JevPage.module.css'

export type { JevConfigValues } from '../types.ts'

/** Browser calls provided by the Jev Remote namespace. */
export interface JevPageRemote {
  listFeatures(): Promise<JevFeatureView[]>
  listRecords(filter: JevRecordFilter): Promise<JevRecordPage>
  getRecord(id: string): Promise<JevRecordDetail | null>
  testConnection(connection: JevConnectionIdentity, signal: AbortSignal): Promise<JevProbeResult>
  getCredentialStatus(connection: JevConnectionIdentity): Promise<JevCredentialStatus>
  setCredential(connection: JevConnectionIdentity, value: string): Promise<JevCredentialStatus>
}

/** Data and commands injected by the bundle registration. */
export interface JevPageFace {
  form: ConfigForm<JevConfigValues>
  selectionForm?: ConfigForm<SelectionConfigValues>
  outputAdmissionForm?: ConfigForm<OutputAdmissionConfigValues>
  supervisionForm?: ConfigForm<SupervisionConfigValues>
  stageNavigationForm?: ConfigForm<StageNavigationConfigValues>
  jev: JevPageRemote
  notifySuccess: (message: string) => void
}

/** Props assembled by the bundle slot and locale renderer. */
export type JevPageProps = PropsRuntime<'plugins.bundle.config'> & PropsLocale<'jev.plugin'> & InjectFace<JevPageFace>

type Translate = (key: JevLocaleKey) => string
type Tab = 'settings' | 'records'

function featureName(feature: Pick<JevFeatureView, 'id' | 'name'>, t: Translate): string {
  if (feature.id === 'shared-findings') return t('sharedFindingsName')
  if (feature.id === 'stage-navigation') return t('stageNavigationName')
  return feature.name
}

function featureDescription(feature: JevFeatureView, t: Translate): string {
  if (feature.id === 'shared-findings') return t('sharedFindingsDescription')
  if (feature.id === 'stage-navigation') return t('stageNavigationDescription')
  return feature.description
}

function recordFeatureName(features: readonly JevFeatureView[], featureId: string, t: Translate): string {
  const feature = features.find(entry => entry.id === featureId)
  return feature ? featureName(feature, t) : featureId
}

const STATUSES: readonly JevRecordStatus[] = ['pending', 'waiting', 'succeeded', 'failed', 'cancelled', 'interrupted']
const PAGE_SIZE = 25

function statusLabel(status: JevRecordStatus, t: Translate): string {
  return t(status)
}

function actionStatusLabel(status: JevActionStatus, t: Translate): string {
  const key: Record<JevActionStatus, JevLocaleKey> = {
    unconfirmed: 'unconfirmed', 'not-adopted': 'notAdopted', cancelled: 'cancelled', executed: 'executed',
    'execution-failed': 'executionFailed', observed: 'observed',
  }
  return t(key[status])
}

function dateText(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString()
}

function JsonDetail({ value }: { value: unknown }) {
  return <pre className={css.code}>{JSON.stringify(value, null, 2)}</pre>
}

function DetailBlock({ label, value }: { label: string; value: unknown }) {
  if (value === undefined) return null
  return <div className={css.detailBlock}><span className={css.detailLabel}>{label}</span><JsonDetail value={value} /></div>
}

function Loading({ label }: { label: string }) {
  return <div className={css.loading} role="status" aria-label={label}><StateDot state="ongoing" size={24} /></div>
}

/** Render one plugin-owned page inside the Host Plugins bundle detail. */
export function JevPage(props: JevPageProps) {
  const [tab, setTab] = useState<Tab>('settings')
  const t = props.t
  if (props.view !== 'page') return null
  return (
    <div className={css.page}>
      <SegmentedTabs
        label={t('tabs')}
        items={[
          { value: 'settings', label: t('settings'), id: 'jev-settings-tab', panelId: 'jev-settings-panel' },
          { value: 'records', label: t('records'), id: 'jev-records-tab', panelId: 'jev-records-panel' },
        ]}
        value={tab}
        onChange={setTab}
        className={css.tabs}
      />
      {tab === 'settings'
        ? <div id="jev-settings-panel" role="tabpanel" aria-labelledby="jev-settings-tab" className={css.panel}>
          <SettingsPanel form={props.form} jev={props.jev} notifySuccess={props.notifySuccess} t={t} />
          {props.supervisionForm && <SupervisionSettings form={props.supervisionForm} notifySuccess={props.notifySuccess} t={t} />}
          {props.selectionForm && <SelectionSettings form={props.selectionForm} notifySuccess={props.notifySuccess} t={t} />}
          {props.outputAdmissionForm && <OutputAdmissionSettings form={props.outputAdmissionForm} notifySuccess={props.notifySuccess} t={t} />}
          {props.stageNavigationForm && <StageNavigationSettings form={props.stageNavigationForm} notifySuccess={props.notifySuccess} t={t} />}
        </div>
        : <div id="jev-records-panel" role="tabpanel" aria-labelledby="jev-records-tab"><RecordsPanel jev={props.jev} t={t} /></div>}
    </div>
  )
}

interface PanelProps { form: ConfigForm<JevConfigValues>; jev: JevPageRemote; notifySuccess: (message: string) => void; t: Translate }

type SelectionField = keyof SelectionConfigValues
const SELECTION_FIELDS: readonly { key: SelectionField; label: JevLocaleKey }[] = [
  { key: 'skillLimit', label: 'skillSummaryCount' },
  { key: 'fileCandidates', label: 'fileRankingMaximum' },
  { key: 'fileLimit', label: 'rankedPathCount' },
]

function parsePositiveInteger(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

type OutputField = keyof OutputAdmissionConfigValues
const OUTPUT_FIELDS: readonly { key: OutputField; label: JevLocaleKey; ratio?: true }[] = [
  { key: 'generalMinChars', label: 'generalMinChars' }, { key: 'testMinChars', label: 'testMinChars' },
  { key: 'generalBlockChars', label: 'generalBlockChars' }, { key: 'maxGeneralBlocks', label: 'maxGeneralBlocks' },
  { key: 'maxTestCandidates', label: 'maxTestCandidates' }, { key: 'maxRequestChars', label: 'maxRequestChars' },
  { key: 'maxTaskChars', label: 'maxTaskChars' }, { key: 'waitMs', label: 'admissionWaitMs' },
  { key: 'omitProbability', label: 'omitProbability', ratio: true }, { key: 'minSavedChars', label: 'minSavedChars' },
  { key: 'minSavedRatio', label: 'minSavedRatio', ratio: true }, { key: 'slowTestMs', label: 'slowTestMs' },
  { key: 'duplicateMinLines', label: 'duplicateMinLines' }, { key: 'duplicateMinChars', label: 'duplicateMinChars' },
]

function OutputAdmissionSettings({ form, notifySuccess, t }: {
  form: ConfigForm<OutputAdmissionConfigValues>; notifySuccess: (message: string) => void; t: Translate
}) {
  const subscribe = useCallback((listener: () => void) => form.subscribe(listener), [form])
  const getSnapshot = useCallback(() => form.getSnapshot(), [form])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const [draft, setDraft] = useState<Partial<Record<OutputField, string>>>({})
  const [invalid, setInvalid] = useState<OutputField[]>([])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const edited = useRef(false)
  const observed = useRef('')
  useEffect(() => {
    if (snapshot.value === undefined) return
    const values = Object.fromEntries(OUTPUT_FIELDS.map(({ key }) => [key, String(snapshot.value![key])])) as Record<OutputField, string>
    const signature = JSON.stringify(values)
    if (signature === observed.current) return
    observed.current = signature
    if (!edited.current) setDraft(values)
  }, [snapshot.value])
  const current = snapshot.value
  const dirty = current !== undefined && OUTPUT_FIELDS.some(({ key }) => draft[key] !== undefined && draft[key] !== String(current[key]))
  useEffect(() => { if (!dirty) edited.current = false }, [dirty])
  const save = async () => {
    const errors: OutputField[] = []
    const values: Partial<OutputAdmissionConfigValues> = {}
    for (const { key, ratio } of OUTPUT_FIELDS) {
      const raw = draft[key] ?? ''
      const value = ratio ? Number(raw) : parsePositiveInteger(raw)
      if (raw.trim() === '' || value === null || !Number.isFinite(value) || ratio && (value < 0 || value > 1)) errors.push(key)
      else values[key] = value
    }
    if (errors.length) { setInvalid(errors); return }
    setSaving(true)
    setSaveError(false)
    try {
      const accepted = await form.mutate(OUTPUT_FIELDS.map(({ key }) => ({ op: 'set' as const, path: [key], value: values[key]! })), snapshot.revision)
      if (!accepted) setSaveError(true)
      else { edited.current = false; notifySuccess(t('outputAdmissionSaved')) }
    } catch { setSaveError(true) }
    finally { setSaving(false) }
  }
  return <section className={css.section} aria-label={t('outputAdmissionSettings')}>
    <h3 className={css.heading}>{t('outputAdmissionSettings')}</h3>
    <p className={css.hint}>{t('outputAdmissionHint')}</p>
    {snapshot.status === 'loading' && current === undefined && <Loading label={t('loading')} />}
    {snapshot.status === 'unavailable' && <p className={css.notice}>{t('unavailable')}</p>}
    {current !== undefined && <div className={css.form}>
      <div className={css.filters}>{OUTPUT_FIELDS.map(({ key, label, ratio }) => <div className={css.field} key={key}>
        <label htmlFor={`jev-output-${key}`}>{t(label)}</label>
        <input id={`jev-output-${key}`} type="number" min={ratio ? '0' : '1'} max={ratio ? '1' : undefined}
          step={ratio ? 'any' : '1'} value={draft[key] ?? String(current[key])} aria-invalid={invalid.includes(key) || undefined}
          disabled={!snapshot.writable || saving} onChange={event => { edited.current = true; setDraft(previous => ({ ...previous, [key]: event.target.value })); setInvalid(previous => previous.filter(item => item !== key)) }} />
        {invalid.includes(key) && <span role="alert" className={css.notice}>{t('outputAdmissionInvalid')}</span>}
      </div>)}</div>
      <div className={css.actions}><Button variant="primary" disabled={!snapshot.writable || saving || !dirty} onClick={() => { void save() }}>{saving ? t('saving') : t('saveOutputAdmission')}</Button></div>
      {saveError && <p role="alert" className={css.notice}>{t('outputAdmissionSaveFailed')}</p>}
    </div>}
  </section>
}

type StageField = keyof StageNavigationConfigValues
const STAGE_FIELDS: readonly { key: StageField; label: JevLocaleKey; min: number; max: number }[] = [
  { key: 'previousSteps', label: 'previousSteps', min: 0, max: 20 },
  { key: 'previousChars', label: 'previousChars', min: 0, max: 100_000 },
  { key: 'maxRequestChars', label: 'stageMaxRequestChars', min: 2048, max: 10_000_000 },
  { key: 'concurrency', label: 'stageConcurrency', min: 1, max: 8 },
]

function StageNavigationSettings({ form, notifySuccess, t }: {
  form: ConfigForm<StageNavigationConfigValues>; notifySuccess: (message: string) => void; t: Translate
}) {
  const subscribe = useCallback((listener: () => void) => form.subscribe(listener), [form])
  const getSnapshot = useCallback(() => form.getSnapshot(), [form])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const [draft, setDraft] = useState<Partial<Record<StageField, string>>>({})
  const [invalid, setInvalid] = useState<StageField[]>([])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const edited = useRef(false)
  const observed = useRef('')
  useEffect(() => {
    if (snapshot.value === undefined) return
    const values = {
      previousSteps: String(snapshot.value.previousSteps), previousChars: String(snapshot.value.previousChars),
      maxRequestChars: String(snapshot.value.maxRequestChars), concurrency: String(snapshot.value.concurrency),
    }
    const signature = JSON.stringify(values)
    if (signature === observed.current) return
    observed.current = signature
    if (!edited.current) setDraft(values)
  }, [snapshot.value])
  const current = snapshot.value
  const dirty = current !== undefined && STAGE_FIELDS.some(({ key }) => draft[key] !== undefined && draft[key] !== String(current[key]))
  useEffect(() => { if (!dirty) edited.current = false }, [dirty])
  const save = async () => {
    const errors: StageField[] = []
    const values: Partial<StageNavigationConfigValues> = {}
    for (const { key, min, max } of STAGE_FIELDS) {
      const raw = draft[key] ?? ''
      const value = Number(raw)
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max) errors.push(key)
      else values[key] = value
    }
    if (errors.length > 0) { setInvalid(errors); return }
    setSaving(true)
    setSaveError(false)
    try {
      const accepted = await form.mutate(STAGE_FIELDS.map(({ key }) => ({ op: 'set' as const, path: [key], value: values[key]! })), snapshot.revision)
      if (!accepted) setSaveError(true)
      else { edited.current = false; notifySuccess(t('stageSaved')) }
    } catch { setSaveError(true) }
    finally { setSaving(false) }
  }
  return <section className={css.section} aria-label={t('stageSettings')}>
    <h3 className={css.heading}>{t('stageSettings')}</h3>
    <p className={css.hint}>{t('stageSettingsHint')}</p>
    {snapshot.status === 'loading' && current === undefined && <Loading label={t('loading')} />}
    {snapshot.status === 'unavailable' && <p className={css.notice}>{t('unavailable')}</p>}
    {current !== undefined && <div className={css.form}>
      <div className={css.filters}>{STAGE_FIELDS.map(({ key, label, min, max }) => <div className={css.field} key={key}>
        <label htmlFor={`jev-stage-${key}`}>{t(label)}</label>
        <input id={`jev-stage-${key}`} type="number" min={min} max={max} step="1" value={draft[key] ?? String(current[key])}
          aria-invalid={invalid.includes(key) || undefined} disabled={!snapshot.writable || saving}
          onChange={event => { edited.current = true; setDraft(previous => ({ ...previous, [key]: event.target.value })); setInvalid(previous => previous.filter(item => item !== key)) }} />
        {invalid.includes(key) && <span role="alert" className={css.notice}>{t('stageInvalid')}</span>}
      </div>)}</div>
      <div className={css.actions}><Button variant="primary" disabled={!snapshot.writable || saving || !dirty} onClick={() => { void save() }}>{saving ? t('saving') : t('saveStageSettings')}</Button></div>
      {saveError && <p role="alert" className={css.notice}>{t('stageSaveFailed')}</p>}
    </div>}
  </section>
}

function SelectionSettings({ form, notifySuccess, t }: {
  form: ConfigForm<SelectionConfigValues>; notifySuccess: (message: string) => void; t: Translate
}) {
  const subscribe = useCallback((listener: () => void) => form.subscribe(listener), [form])
  const getSnapshot = useCallback(() => form.getSnapshot(), [form])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const [draft, setDraft] = useState<Record<SelectionField, string>>({ skillLimit: '', fileCandidates: '', fileLimit: '' })
  const [errors, setErrors] = useState<Partial<Record<SelectionField, boolean>>>({})
  const [saveError, setSaveError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const edited = useRef(false)
  const observed = useRef('')

  useEffect(() => {
    if (snapshot.value === undefined) return
    const next = {
      skillLimit: String(snapshot.value.skillLimit),
      fileCandidates: String(snapshot.value.fileCandidates),
      fileLimit: String(snapshot.value.fileLimit),
    }
    const signature = JSON.stringify(next)
    if (signature === observed.current) return
    observed.current = signature
    if (!edited.current) setDraft(next)
    setHydrated(true)
  }, [snapshot.value])

  const current = snapshot.value
  const dirty = hydrated && current !== undefined && SELECTION_FIELDS.some(({ key }) => draft[key] !== String(current[key]))

  useEffect(() => { if (!dirty) edited.current = false }, [dirty])

  const edit = (key: SelectionField, value: string) => {
    edited.current = true
    setDraft(previous => ({ ...previous, [key]: value }))
    setErrors(previous => ({ ...previous, [key]: false }))
    setSaveError(false)
  }

  const save = async () => {
    const parsed = {} as SelectionConfigValues
    const nextErrors: Partial<Record<SelectionField, boolean>> = {}
    for (const { key } of SELECTION_FIELDS) {
      const value = parsePositiveInteger(draft[key])
      if (value === null) nextErrors[key] = true
      else parsed[key] = value
    }
    if (Object.keys(nextErrors).length > 0) { setErrors(nextErrors); return }
    setSaving(true)
    setSaveError(false)
    try {
      const accepted = await form.mutate(SELECTION_FIELDS.map(({ key }) => ({ op: 'set' as const, path: [key], value: parsed[key] })), snapshot.revision)
      if (accepted) {
        const saved = form.getSnapshot().value
        if (saved !== undefined) {
          setDraft({ skillLimit: String(saved.skillLimit), fileCandidates: String(saved.fileCandidates), fileLimit: String(saved.fileLimit) })
          edited.current = false
        }
        notifySuccess(t('selectionCountSaved'))
      } else setSaveError(true)
    } catch { setSaveError(true) }
    finally { setSaving(false) }
  }

  return <section className={css.section} aria-label={t('selectionCounts')}>
    <h3 className={css.heading}>{t('selectionCounts')}</h3>
    <p className={css.hint}>{t('selectionCountsHint')}</p>
    {snapshot.status === 'loading' && current === undefined && <Loading label={t('loading')} />}
    {snapshot.status === 'unavailable' && <p className={css.notice}>{t('unavailable')}</p>}
    {current !== undefined && <div className={css.form}>
      <div className={css.filters}>{SELECTION_FIELDS.map(({ key, label }) => <div className={css.field} key={key}>
        <label htmlFor={`jev-selection-${key}`}>{t(label)}</label>
        <input id={`jev-selection-${key}`} type="text" inputMode="numeric" value={draft[key]} aria-invalid={errors[key] || undefined} aria-describedby={errors[key] ? `jev-selection-${key}-error` : undefined} disabled={!snapshot.writable || saving} onChange={event => { edit(key, event.target.value) }} />
        {errors[key] && <span id={`jev-selection-${key}-error`} role="alert" className={css.notice}>{t('selectionCountInvalid')}</span>}
      </div>)}</div>
      <div className={css.actions}><Button variant="primary" disabled={!snapshot.writable || saving || !dirty} onClick={() => { void save() }}>{saving ? t('saving') : t('saveSelectionCounts')}</Button>{!snapshot.writable && <span className={css.hint}>{t('readOnly')}</span>}</div>
      {saveError && <p role="alert" className={css.notice}>{t('selectionCountSaveFailed')}</p>}
    </div>}
  </section>
}

type SupervisionField = keyof SupervisionConfigValues
const SUPERVISION_FIELDS: readonly { key: SupervisionField; label: JevLocaleKey }[] = [
  { key: 'driftInterval', label: 'driftInterval' },
  { key: 'noProgressRounds', label: 'noProgressRounds' },
  { key: 'evidenceChars', label: 'evidenceChars' },
]

function SupervisionSettings({ form, notifySuccess, t }: {
  form: ConfigForm<SupervisionConfigValues>; notifySuccess: (message: string) => void; t: Translate
}) {
  const subscribe = useCallback((listener: () => void) => form.subscribe(listener), [form])
  const getSnapshot = useCallback(() => form.getSnapshot(), [form])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const [draft, setDraft] = useState<Record<SupervisionField, string>>({ driftInterval: '', noProgressRounds: '', evidenceChars: '' })
  const [errors, setErrors] = useState<Partial<Record<SupervisionField, boolean>>>({})
  const [saveError, setSaveError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const edited = useRef(false)
  const observed = useRef('')

  useEffect(() => {
    if (snapshot.value === undefined) return
    const next = {
      driftInterval: String(snapshot.value.driftInterval),
      noProgressRounds: String(snapshot.value.noProgressRounds),
      evidenceChars: String(snapshot.value.evidenceChars),
    }
    const signature = JSON.stringify(next)
    if (signature === observed.current) return
    observed.current = signature
    if (!edited.current) setDraft(next)
    setHydrated(true)
  }, [snapshot.value])

  const current = snapshot.value
  const dirty = hydrated && current !== undefined && SUPERVISION_FIELDS.some(({ key }) => draft[key] !== String(current[key]))

  useEffect(() => { if (!dirty) edited.current = false }, [dirty])

  const edit = (key: SupervisionField, value: string) => {
    edited.current = true
    setDraft(previous => ({ ...previous, [key]: value }))
    setErrors(previous => ({ ...previous, [key]: false }))
    setSaveError(false)
  }

  const save = async () => {
    const parsed = {} as SupervisionConfigValues
    const nextErrors: Partial<Record<SupervisionField, boolean>> = {}
    for (const { key } of SUPERVISION_FIELDS) {
      const value = parsePositiveInteger(draft[key])
      if (value === null) nextErrors[key] = true
      else parsed[key] = value
    }
    if (Object.keys(nextErrors).length > 0) { setErrors(nextErrors); return }
    setSaving(true)
    setSaveError(false)
    try {
      const accepted = await form.mutate(SUPERVISION_FIELDS.map(({ key }) => ({ op: 'set' as const, path: [key], value: parsed[key] })), snapshot.revision)
      if (accepted) {
        const saved = form.getSnapshot().value
        if (saved !== undefined) {
          setDraft({ driftInterval: String(saved.driftInterval), noProgressRounds: String(saved.noProgressRounds), evidenceChars: String(saved.evidenceChars) })
          edited.current = false
        }
        notifySuccess(t('supervisionCountSaved'))
      } else setSaveError(true)
    } catch { setSaveError(true) }
    finally { setSaving(false) }
  }

  return <section className={css.section} aria-label={t('supervisionCounts')}>
    <h3 className={css.heading}>{t('supervisionCounts')}</h3>
    <p className={css.hint}>{t('supervisionCountsHint')}</p>
    {snapshot.status === 'loading' && current === undefined && <Loading label={t('loading')} />}
    {snapshot.status === 'unavailable' && <p className={css.notice}>{t('unavailable')}</p>}
    {current !== undefined && <div className={css.form}>
      <div className={css.filters}>{SUPERVISION_FIELDS.map(({ key, label }) => <div className={css.field} key={key}>
        <label htmlFor={`jev-supervision-${key}`}>{t(label)}</label>
        <input id={`jev-supervision-${key}`} type="text" inputMode="numeric" value={draft[key]} aria-invalid={errors[key] || undefined} aria-describedby={errors[key] ? `jev-supervision-${key}-error` : undefined} disabled={!snapshot.writable || saving} onChange={event => { edit(key, event.target.value) }} />
        {errors[key] && <span id={`jev-supervision-${key}-error`} role="alert" className={css.notice}>{t('supervisionCountInvalid')}</span>}
      </div>)}</div>
      <div className={css.actions}><Button variant="primary" disabled={!snapshot.writable || saving || !dirty} onClick={() => { void save() }}>{saving ? t('saving') : t('saveSupervisionCounts')}</Button>{!snapshot.writable && <span className={css.hint}>{t('readOnly')}</span>}</div>
      {saveError && <p role="alert" className={css.notice}>{t('supervisionCountSaveFailed')}</p>}
    </div>}
  </section>
}

type ConnectionDraft = Omit<JevConfigValues, 'features' | 'timeoutMs'> & { timeoutMs: string }

function connectionDraft(value: JevConfigValues): ConnectionDraft {
  return {
    baseUrl: value.baseUrl, model: value.model, credentialRef: value.credentialRef,
    timeoutMs: String(value.timeoutMs), judgmentModel: value.judgmentModel ?? 'jev', lunaApi: value.lunaApi ?? 'openrouter',
    lunaOpenRouterBaseUrl: value.lunaOpenRouterBaseUrl ?? 'https://openrouter.ai/api/alpha/decisions',
    lunaOpenRouterCredentialRef: value.lunaOpenRouterCredentialRef ?? 'JEV_LUNA_OPENROUTER_API_KEY',
    lunaOpenAIBaseUrl: value.lunaOpenAIBaseUrl ?? 'https://api.openai.com/v1/decisions',
    lunaOpenAICredentialRef: value.lunaOpenAICredentialRef ?? 'JEV_LUNA_OPENAI_API_KEY',
  }
}

const EMPTY_DRAFT = connectionDraft({ baseUrl: '', model: 'jev-latest', credentialRef: 'JEV_API_KEY', timeoutMs: 10000, features: {},
  judgmentModel: 'jev', lunaApi: 'openrouter', lunaOpenRouterBaseUrl: 'https://openrouter.ai/api/alpha/decisions',
  lunaOpenRouterCredentialRef: 'JEV_LUNA_OPENROUTER_API_KEY', lunaOpenAIBaseUrl: 'https://api.openai.com/v1/decisions',
  lunaOpenAICredentialRef: 'JEV_LUNA_OPENAI_API_KEY' })

function identityKey(connection: JevConnectionIdentity): string {
  return JSON.stringify([connection.connectionId, connection.baseUrl, connection.model, connection.credentialRef, connection.timeoutMs])
}

function SettingsPanel({ form, jev, notifySuccess, t }: PanelProps) {
  const subscribe = useCallback((listener: () => void) => form.subscribe(listener), [form])
  const getSnapshot = useCallback(() => form.getSnapshot(), [form])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const [draft, setDraft] = useState<ConnectionDraft>(EMPTY_DRAFT)
  const editedConnection = useRef(new Set<keyof ConnectionDraft>())
  const observedConnection = useRef('')
  const draftRef = useRef(draft)
  draftRef.current = draft
  const [features, setFeatures] = useState<readonly JevFeatureView[]>([])
  const [featureLoading, setFeatureLoading] = useState(true)
  const [featureError, setFeatureError] = useState('')
  const [featureErrorLabel, setFeatureErrorLabel] = useState<'featureLoadFailed' | 'featureSaveFailed'>('featureLoadFailed')
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')
  const [featureBusy, setFeatureBusy] = useState('')
  const [credential, setCredential] = useState<JevCredentialStatus | null>(null)
  const [credentialMessage, setCredentialMessage] = useState('')
  const [secret, setSecret] = useState('')
  const [secretSaving, setSecretSaving] = useState(false)
  const [probe, setProbe] = useState<JevProbeResult | null>(null)
  const [probeError, setProbeError] = useState('')
  const [testing, setTesting] = useState(false)
  const probeAbort = useRef<AbortController | null>(null)
  const alive = useRef(true)
  const saveGeneration = useRef(0)
  const credentialGeneration = useRef(0)
  const keyGeneration = useRef(0)
  const probeGeneration = useRef(0)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      saveGeneration.current++
      credentialGeneration.current++
      keyGeneration.current++
      probeGeneration.current++
      probeAbort.current?.abort()
    }
  }, [form, jev])

  useEffect(() => {
    if (snapshot.value === undefined) return
    const next = connectionDraft(snapshot.value)
    const signature = JSON.stringify(next)
    if (signature === observedConnection.current) return
    observedConnection.current = signature
    setDraft(previous => {
      const merged = { ...next }
      for (const field of editedConnection.current) Object.assign(merged, { [field]: previous[field] })
      return merged
    })
  }, [snapshot.value])

  const current = snapshot.value
  const dirty = current !== undefined && JSON.stringify(draft) !== JSON.stringify(connectionDraft(current))
  useEffect(() => { if (!dirty) editedConnection.current.clear() }, [dirty])
  const draftValues: JevConfigValues = { ...draft, timeoutMs: Number(draft.timeoutMs), features: current?.features ?? {} }
  const displayedConnection = resolveConnectionIdentity(draftValues)
  const savedConnection = current === undefined ? undefined : resolveConnectionIdentity({ ...current, ...connectionDraft(current), timeoutMs: current.timeoutMs })
  const contextKey = JSON.stringify({ draft, savedConnection, dirty, status: snapshot.status })
  const contextRef = useRef(contextKey)
  contextRef.current = contextKey

  const loadFeatures = useCallback(async () => {
    setFeatureLoading(true)
    setFeatureError('')
    try { const next = await jev.listFeatures(); if (alive.current) setFeatures(next) }
    catch { if (alive.current) { setFeatureErrorLabel('featureLoadFailed'); setFeatureError(t('featureLoadFailed')) } }
    finally { if (alive.current) setFeatureLoading(false) }
  }, [jev, t])
  useEffect(() => { void loadFeatures() }, [loadFeatures])

  // A completion can update only the exact saved connection still shown by this form.
  useEffect(() => {
    const generation = ++credentialGeneration.current
    keyGeneration.current++
    probeGeneration.current++
    probeAbort.current?.abort()
    probeAbort.current = null
    setCredential(null)
    setCredentialMessage('')
    setSecret('')
    setSecretSaving(false)
    setProbe(null)
    setProbeError('')
    setTesting(false)
    if (dirty || savedConnection === undefined || snapshot.status !== 'ready') return
    const connection = savedConnection
    void jev.getCredentialStatus(connection).then(result => {
      if (!alive.current || generation !== credentialGeneration.current || contextRef.current !== contextKey) return
      if (identityKey(result.connection) !== identityKey(connection)) { setCredentialMessage(t('connectionChanged')); return }
      setCredential(result)
    }, () => {
      if (alive.current && generation === credentialGeneration.current && contextRef.current === contextKey) setCredentialMessage(t('unavailable'))
    })
  }, [contextKey, form, jev, t])

  const editConnection = <K extends keyof ConnectionDraft>(field: K, value: ConnectionDraft[K]) => {
    editedConnection.current.add(field)
    setSaveMessage('')
    setDraft(previous => ({ ...previous, [field]: value }))
  }

  const saveConnection = async () => {
    const submission = { ...draft, baseUrl: draft.baseUrl.trim(), model: draft.model.trim(), credentialRef: draft.credentialRef.trim(),
      lunaOpenRouterBaseUrl: draft.lunaOpenRouterBaseUrl.trim(), lunaOpenRouterCredentialRef: draft.lunaOpenRouterCredentialRef.trim(),
      lunaOpenAIBaseUrl: draft.lunaOpenAIBaseUrl.trim(), lunaOpenAICredentialRef: draft.lunaOpenAICredentialRef.trim() }
    const timeoutMs = Number(draft.timeoutMs)
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000) { setSaveMessage(t('invalidTimeout')); return }
    const generation = ++saveGeneration.current
    const submittedDraft = JSON.stringify(draft)
    setSaving(true)
    setSaveMessage('')
    try {
      const values = { ...submission, timeoutMs }
      const accepted = await form.mutate(Object.entries(values).map(([key, value]) => ({ op: 'set' as const, path: [key], value })), snapshot.revision)
      if (!alive.current || generation !== saveGeneration.current || JSON.stringify(draftRef.current) !== submittedDraft) return
      if (!accepted) { setSaveMessage(t('saveFailed')); return }
      const saved = form.getSnapshot().value
      if (saved === undefined || JSON.stringify(connectionDraft(saved)) !== JSON.stringify({ ...submission, timeoutMs: String(timeoutMs) })) {
        setSaveMessage(t('connectionChanged'))
        return
      }
      editedConnection.current.clear()
      setDraft(connectionDraft(saved))
      notifySuccess(t('saveSuccess'))
    } catch { if (alive.current && generation === saveGeneration.current) setSaveMessage(t('saveFailed')) }
    finally { if (alive.current && generation === saveGeneration.current) setSaving(false) }
  }

  const saveKey = async () => {
    if (!secret || dirty || savedConnection === undefined || !credential?.writable) return
    const connection = savedConnection
    const capturedContext = contextKey
    const generation = ++keyGeneration.current
    setSecretSaving(true)
    setCredentialMessage('')
    try {
      const result = await jev.setCredential(connection, secret)
      if (!alive.current || generation !== keyGeneration.current || contextRef.current !== capturedContext) return
      if (identityKey(result.connection) !== identityKey(connection)) { setCredentialMessage(t('connectionChanged')); return }
      credentialGeneration.current++
      setCredential(result)
      setSecret('')
      notifySuccess(t('keySaved'))
    } catch {
      if (alive.current && generation === keyGeneration.current && contextRef.current === capturedContext) setCredentialMessage(t('keySaveFailed'))
    } finally {
      if (alive.current && generation === keyGeneration.current && contextRef.current === capturedContext) setSecretSaving(false)
    }
  }

  const runProbe = async () => {
    if (dirty || savedConnection === undefined || snapshot.status !== 'ready') return
    const connection = savedConnection
    const capturedContext = contextKey
    const generation = ++probeGeneration.current
    const controller = new AbortController()
    probeAbort.current = controller
    setTesting(true)
    setProbe(null)
    setProbeError('')
    try {
      const result = await jev.testConnection(connection, controller.signal)
      if (!alive.current || generation !== probeGeneration.current || contextRef.current !== capturedContext || controller.signal.aborted) return
      if (identityKey(result.connection) !== identityKey(connection)) { setProbeError(t('connectionChanged')); return }
      setProbe(result)
    } catch {
      if (alive.current && generation === probeGeneration.current && contextRef.current === capturedContext && !controller.signal.aborted) setProbeError(t('testFailed'))
    } finally {
      if (probeAbort.current === controller) probeAbort.current = null
      if (alive.current && generation === probeGeneration.current && contextRef.current === capturedContext) setTesting(false)
    }
  }

  const toggleFeature = async (id: string, enabled: boolean) => {
    setFeatureBusy(id)
    setFeatureError('')
    try {
      const accepted = await form.mutate([{ op: 'set', path: ['features', id], value: enabled }], snapshot.revision)
      if (!accepted && alive.current) { setFeatureErrorLabel('featureSaveFailed'); setFeatureError(t('featureSaveFailed')) }
    } catch { if (alive.current) { setFeatureErrorLabel('featureSaveFailed'); setFeatureError(t('featureSaveFailed')) } }
    finally { if (alive.current) setFeatureBusy('') }
  }

  const endpointField = draft.judgmentModel === 'jev' ? 'baseUrl' : draft.lunaApi === 'openrouter' ? 'lunaOpenRouterBaseUrl' : 'lunaOpenAIBaseUrl'
  const referenceField = draft.judgmentModel === 'jev' ? 'credentialRef' : draft.lunaApi === 'openrouter' ? 'lunaOpenRouterCredentialRef' : 'lunaOpenAICredentialRef'
  return (
    <div className={css.panel}>
      <section className={css.section} aria-label={t('connection')}>
        <h3 className={css.heading}>{t('connection')}</h3>
        <p className={css.hint}>{t('connectionHint')}</p>
        {snapshot.status === 'loading' && current === undefined && <Loading label={t('loading')} />}
        {snapshot.status === 'unavailable' && <p className={css.notice}>{t('unavailable')}</p>}
        {current !== undefined && <div className={css.form}>
          <div className={css.filters}>
            <label className={css.field}><span>{t('decisionModel')}</span><select value={draft.judgmentModel} disabled={!snapshot.writable || saving} onChange={event => { editConnection('judgmentModel', event.target.value as JevConfigValues['judgmentModel']) }}><option value="jev">{t('jevModel')}</option><option value="luna">{t('lunaModel')}</option></select></label>
            {draft.judgmentModel === 'luna' && <label className={css.field}><span>{t('lunaApi')}</span><select value={draft.lunaApi} disabled={!snapshot.writable || saving} onChange={event => { editConnection('lunaApi', event.target.value as JevConfigValues['lunaApi']) }}><option value="openrouter">{t('openRouter')}</option><option value="openai">{t('openAI')}</option></select></label>}
          </div>
          <div className={css.filters}>
            <label className={css.field}><span>{t('baseUrl')}</span><input value={draft[endpointField]} disabled={!snapshot.writable || saving} onChange={event => { editConnection(endpointField, event.target.value) }} /></label>
            <label className={css.field}><span>{t('model')}</span><input aria-label={t('model')} aria-describedby={draft.judgmentModel === 'luna' ? 'jev-luna-model-hint' : undefined} value={draft.judgmentModel === 'jev' ? draft.model : displayedConnection.model} readOnly={draft.judgmentModel === 'luna'} disabled={!snapshot.writable || saving} onChange={event => { if (draft.judgmentModel === 'jev') editConnection('model', event.target.value) }} />{draft.judgmentModel === 'luna' && <span id="jev-luna-model-hint" className={css.hint}>{t('lunaModelHint')}</span>}</label>
            <label className={css.field}><span>{t('credentialRef')}</span><input value={draft[referenceField]} disabled={!snapshot.writable || saving} onChange={event => { editConnection(referenceField, event.target.value) }} /></label>
            <label className={css.field}><span>{t('timeoutMs')}</span><input type="number" min="1" max="300000" step="1" value={draft.timeoutMs} disabled={!snapshot.writable || saving} onChange={event => { editConnection('timeoutMs', event.target.value) }} /></label>
          </div>
          <div className={css.actions}><Button variant="primary" disabled={!snapshot.writable || saving || !dirty} onClick={() => { void saveConnection() }}>{saving ? t('saving') : t('saveConnection')}</Button>{!snapshot.writable && <span className={css.hint}>{t('readOnly')}</span>}</div>
          {saveMessage && <p role="status" className={css.notice}>{saveMessage}</p>}
        </div>}
        <div className={css.form}>
          <label className={css.field}><span>{t('apiKey')}{credential !== null ? ` · ${credential.configured ? t('configured') : t('missing')}${!credential.writable ? ` · ${t('readOnly')}` : ''}` : ''}</span><input aria-label={t('apiKey')} aria-describedby="jev-api-key-hint" type="password" autoComplete="new-password" value={secret} disabled={!credential?.writable || secretSaving || dirty} onChange={event => { setSecret(event.target.value) }} /><span id="jev-api-key-hint" className={css.hint}>{t('apiKeyHint')}</span></label>
          <div className={css.actions}><Button disabled={!secret || !credential?.writable || secretSaving || dirty} onClick={() => { void saveKey() }}>{secretSaving ? t('saving') : credential?.configured ? t('replaceKey') : t('saveKey')}</Button><Button disabled={testing || dirty || snapshot.status !== 'ready'} onClick={() => { void runProbe() }}>{testing ? t('testing') : t('testConnection')}</Button></div>
          <p className={css.hint}>{t('diagnosticHint')}</p>
          {dirty && <p className={css.hint}>{t('saveFirst')}</p>}
          {credentialMessage && <p role="status" className={css.notice}>{credentialMessage}</p>}
          {probe && <p role="status" className={probe.ok ? css.success : css.notice}>{t(probe.ok ? 'testSucceeded' : 'testFailed')} · {t('latency')}: {probe.latencyMs} ms{probe.failure ? ` · ${probe.failure.code}: ${probe.failure.message}` : ''}</p>}
          {probeError && <p role="alert" className={css.notice}>{probeError}</p>}
        </div>
      </section>
      <section className={css.section} aria-label={t('features')}>
        <div className={css.recordHead}><h3 className={css.heading}>{t('features')}</h3><Button size="sm" disabled={featureLoading} onClick={() => { void loadFeatures() }}>{t('refreshFeatures')}</Button></div>
        {featureLoading && features.length === 0 && current !== undefined && <Loading label={t('loading')} />}
        {featureError && <p role="alert" className={css.notice}>{featureError} {featureErrorLabel === 'featureLoadFailed' && <Button size="sm" onClick={() => { void loadFeatures() }}>{t('retry')}</Button>}</p>}
        {!featureLoading && !featureError && features.length === 0 && <p className={css.empty}>{t('noFeatures')}</p>}
        <div className={css.list}>{features.map(feature => {
          const enabled = current?.features?.[feature.id] ?? feature.enabled
          return <div className={css.feature} key={feature.id}><div className={css.featureBody}><span className={css.featureTitle}>{featureName(feature, t)}</span><span className={css.description}>{featureDescription(feature, t)}</span>{feature.settingsDescription && <span className={css.hint}>{feature.settingsDescription}</span>}</div><Switch checked={enabled} label={`${enabled ? t('disable') : t('enable')} ${featureName(feature, t)}`} disabled={!snapshot.writable || featureBusy !== ''} onChange={next => { void toggleFeature(feature.id, next) }} /></div>
        })}</div>
      </section>
    </div>
  )
}

interface RecordsProps { jev: JevPageRemote; t: Translate }

function RecordsPanel({ jev, t }: RecordsProps) {
  const [features, setFeatures] = useState<readonly JevFeatureView[]>([])
  const [featureId, setFeatureId] = useState('')
  const [status, setStatus] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [filter, setFilter] = useState<JevRecordFilter>({ limit: PAGE_SIZE })
  const [items, setItems] = useState<readonly JevRecordSummary[]>([])
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState('')
  const [detail, setDetail] = useState<JevRecordDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const queryGeneration = useRef(0)
  const detailGeneration = useRef(0)

  const query = useCallback(async (nextFilter: JevRecordFilter, append: boolean) => {
    const generation = ++queryGeneration.current
    setLoading(true)
    setError('')
    try {
      const page = await jev.listRecords(nextFilter)
      if (generation !== queryGeneration.current) return
      setItems(previous => append ? [...previous, ...page.items] : page.items)
      setNextCursor(page.nextCursor)
    } catch { if (generation === queryGeneration.current) setError(t('recordsFailed')) }
    finally { if (generation === queryGeneration.current) setLoading(false) }
  }, [jev, t])

  useEffect(() => {
    void query({ limit: PAGE_SIZE }, false)
    void jev.listFeatures().then(setFeatures, () => {})
    return () => { queryGeneration.current++; detailGeneration.current++ }
  }, [jev, query])

  const applyFilters = () => {
    detailGeneration.current++
    const next: JevRecordFilter = { limit: PAGE_SIZE }
    if (featureId) next.featureId = featureId
    if (status) next.status = status as JevRecordStatus
    if (sessionId.trim()) next.sessionId = sessionId.trim()
    setFilter(next)
    setSelected('')
    setDetail(null)
    void query(next, false)
  }

  const openDetail = async (id: string) => {
    const generation = ++detailGeneration.current
    setSelected(id)
    setDetailLoading(true)
    setDetailError('')
    if (detail?.id !== id) setDetail(null)
    try {
      const result = await jev.getRecord(id)
      if (generation === detailGeneration.current) setDetail(result)
    } catch { if (generation === detailGeneration.current) setDetailError(t('detailFailed')) }
    finally { if (generation === detailGeneration.current) setDetailLoading(false) }
  }

  const closeDetail = () => { detailGeneration.current++; setSelected(''); setDetail(null); setDetailError(''); setDetailLoading(false) }

  return <div className={css.panel}>
    <section className={css.section} aria-label={t('records')}>
      <div className={css.filters}>
        <label className={css.field}><span>{t('feature')}</span><input list="jev-feature-suggestions" placeholder={t('allFeatures')} value={featureId} onChange={event => { setFeatureId(event.target.value) }} /><datalist id="jev-feature-suggestions">{features.map(feature => <option value={feature.id} key={feature.id} label={featureName(feature, t)} />)}</datalist></label>
        <label className={css.field}><span>{t('status')}</span><select value={status} onChange={event => { setStatus(event.target.value) }}><option value="">{t('allStatuses')}</option>{STATUSES.map(value => <option value={value} key={value}>{statusLabel(value, t)}</option>)}</select></label>
        <label className={css.field}><span>{t('sessionId')}</span><input value={sessionId} onChange={event => { setSessionId(event.target.value) }} /></label>
      </div>
      <div className={css.actions}><Button variant="primary" onClick={applyFilters} disabled={loading}>{t('applyFilters')}</Button><Button onClick={() => { void query(filter, false) }} disabled={loading}>{t('refresh')}</Button></div>
      {error && <p role="alert" className={css.notice}>{error} <Button size="sm" onClick={() => { void query(filter, false) }}>{t('retry')}</Button></p>}
      {loading && items.length === 0 && <Loading label={t('loading')} />}
      {!loading && !error && items.length === 0 && <p className={css.empty}>{t('noRecords')}</p>}
      <div className={css.list}>{items.map(item => <article className={css.record} key={item.id}>
        <div className={css.recordHead}><span className={css.featureTitle}>{item.diagnostic ? t('diagnostic') : recordFeatureName(features, item.featureId, t)}</span><span className={css.meta}>{statusLabel(item.status, t)}</span></div>
        <span className={css.meta}>{t('time')}: {dateText(item.startedAt)} · {t('attempts')}: {item.attempts}{item.sessionId ? ` · ${t('sessionId')}: ${item.sessionId}` : ''}</span>
        <div><Button size="sm" onClick={() => { void openDetail(item.id) }}>{t('details')}</Button></div>
      </article>)}</div>
      {nextCursor && <div className={css.actions}><Button disabled={loading} onClick={() => { void query({ ...filter, cursor: nextCursor }, true) }}>{loading ? t('loading') : t('loadMore')}</Button></div>}
    </section>
    {selected && <section className={css.section} aria-label={t('details')}><div className={css.recordHead}><h3 className={css.heading}>{t('details')}</h3><Button size="sm" onClick={closeDetail}>{t('closeDetails')}</Button></div>
      {detailError && <p role="alert" className={css.notice}>{detailError} <Button size="sm" onClick={() => { void openDetail(selected) }}>{t('retry')}</Button></p>}
      {detailLoading && !detail && <Loading label={t('loading')} />}
      {!detailLoading && !detailError && !detail && <p className={css.empty}>{t('noDetail')}</p>}
      {detail && <div className={css.detail}>
        <div className={css.meta}>{t('operation')}: {detail.id} · {t('status')}: {statusLabel(detail.status, t)}</div>
        <DetailBlock label={t('operation')} value={detail.link} />
        <DetailBlock label={t('failure')} value={detail.failure} />
        <h4 className={css.heading}>{t('attempts')}</h4>
        {detail.attemptRecords.map((attempt, index) => <div className={css.record} key={attempt.id}>
          <div className={css.meta}>#{index + 1} · {dateText(attempt.startedAt)} · {statusLabel(attempt.status, t)}{attempt.latencyMs !== undefined ? ` · ${t('latency')}: ${attempt.latencyMs} ms` : ''}</div>
          <DetailBlock label={t('connectionIdentity')} value={attempt.connection} />
          <DetailBlock label={t('input')} value={attempt.request.state} />
          <DetailBlock label={t('questions')} value={attempt.request.questions} />
          <DetailBlock label={t('rawAnswer')} value={attempt.rawResponse} />
          <DetailBlock label={t('answer')} value={attempt.response} />
          <DetailBlock label={t('interpretation')} value={attempt.interpretation} />
          <DetailBlock label={t('failure')} value={attempt.failure} />
          <DetailBlock label={t('usage')} value={attempt.usage} />
          {attempt.usageComplete === false && <p className={css.hint}>{t('usageIncomplete')}</p>}
          {attempt.networkRecords !== undefined && <div className={css.detail}>
            <h4 className={css.heading}>{t('providerRequests')}</h4>
            {attempt.networkRecords.map(packet => <div className={css.record} key={packet.id}>
              <span className={css.meta}>{packet.id} · {statusLabel(packet.status, t)}{packet.httpStatus !== undefined ? ` · HTTP ${packet.httpStatus}` : ''}</span>
              <DetailBlock label={t('questionIds')} value={packet.questionIds} />
              <DetailBlock label={t('requestBody')} value={packet.requestBody} />
              <DetailBlock label={t('reportedModel')} value={packet.returnedModel} />
              <DetailBlock label={t('requestId')} value={packet.requestId} />
              {packet.rawResponseText !== undefined && <div className={css.detailBlock}><span className={css.detailLabel}>{t('rawAnswer')}</span><pre className={css.code}>{packet.rawResponseText}</pre></div>}
              {packet.rawResponseText === undefined && <DetailBlock label={t('rawAnswer')} value={packet.rawResponse} />}
              <DetailBlock label={t('usage')} value={packet.usage} />
              <DetailBlock label={t('failure')} value={packet.failure} />
            </div>)}
          </div>}
        </div>)}
        <h4 className={css.heading}>{t('receipts')}</h4>
        {detail.receipts.length === 0 ? <p className={css.empty}>{t('noDetail')}</p> : detail.receipts.map(receipt => <div className={css.record} key={receipt.id}><span className={css.meta}>{dateText(receipt.at)} · {actionStatusLabel(receipt.status, t)}</span><DetailBlock label={t('actualAction')} value={receipt.reason ?? receipt.id} /></div>)}
      </div>}
    </section>}
  </div>
}
