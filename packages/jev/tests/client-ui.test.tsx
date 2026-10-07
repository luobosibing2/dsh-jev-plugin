// @vitest-environment jsdom
/** Jev page behavior at the Host configuration and Remote seams. */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import type { ButtonHTMLAttributes } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { JevPage, type JevConfigValues, type JevPageRemote } from '../src/client/JevPage.tsx'
import { en, zh, type JevLocaleKey } from '../src/client/locales.ts'
import type { SupervisionConfigValues } from '../src/supervision-types.ts'
import type { SelectionConfigValues } from '../src/selection-types.ts'
import type { StageNavigationConfigValues } from '../src/stage-types.ts'
import { resolveConnectionIdentity, type JevCredentialStatus, type JevProbeResult, type JevRecordDetail, type JevRecordSummary } from '../src/types.ts'
import { clientConfig } from './client-fixtures.ts'

// The published primitive barrel imports optional DSH libraries that the Host
// module table supplies at runtime. These narrow atoms keep component tests
// focused on Jev's state and accessibility wiring.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ children, variant: _variant, size: _size, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => <button type="button" {...props}>{children}</button>,
  SegmentedTabs: ({ items, value, onChange, label }: { items: readonly { value: string; label: string; id: string; panelId: string }[]; value: string; onChange: (value: 'settings' | 'records') => void; label: string }) => <div role="tablist" aria-label={label}>{items.map(item => <button type="button" role="tab" key={item.value} aria-selected={value === item.value} onClick={() => { onChange(item.value as 'settings' | 'records') }}>{item.label}</button>)}</div>,
  StateDot: () => <span aria-hidden="true" />,
  Switch: ({ checked, onChange, label, disabled }: { checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean }) => <button type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={() => { onChange(!checked) }} />,
}))

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function formStub(accept = true, initial = clientConfig()) {
  let snapshot: ConfigFormSnapshot<JevConfigValues> = {
    status: 'ready',
    value: structuredClone(initial),
    base: {}, user: {}, revision: 1, writable: true, mode: 'host',
  }
  const listeners = new Set<() => void>()
  const mutate = vi.fn(async (ops: readonly { op: string; path: readonly string[]; value?: unknown }[], expectedRevision?: number) => {
    if (!accept || expectedRevision !== snapshot.revision) return false
    const value = structuredClone(snapshot.value!)
    for (const op of ops) {
      if (op.op !== 'set') continue
      if (op.path[0] === 'features') value.features[op.path[1]!] = Boolean(op.value)
      else Object.assign(value, { [op.path[0]!]: op.value })
    }
    snapshot = { ...snapshot, value, revision: snapshot.revision! + 1 }
    for (const listener of listeners) listener()
    return true
  })
  const form: ConfigForm<JevConfigValues> = {
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    mutate,
    set: async () => false,
    unset: async () => false,
  }
  return { form, mutate, update: (changes: Partial<JevConfigValues>) => { snapshot = { ...snapshot, value: { ...snapshot.value!, ...changes }, revision: snapshot.revision! + 1 }; for (const listener of listeners) listener() } }
}

function selectionFormStub(options: { accept?: boolean; initial?: SelectionConfigValues; loading?: boolean } = {}) {
  let snapshot: ConfigFormSnapshot<SelectionConfigValues> = {
    status: options.loading ? 'loading' : 'ready',
    value: options.loading ? undefined : options.initial ?? { skillLimit: 5, fileCandidates: 40, fileLimit: 12 },
    base: {}, user: {}, revision: 4, writable: true, mode: 'host',
  }
  const listeners = new Set<() => void>()
  const publish = () => { for (const listener of listeners) listener() }
  const mutate = vi.fn(async (ops: readonly { op: string; path: readonly string[]; value?: unknown }[], expectedRevision?: number) => {
    if (options.accept === false || expectedRevision !== snapshot.revision || snapshot.value === undefined) return false
    const value = { ...snapshot.value }
    for (const op of ops) {
      if (op.op === 'set') Object.assign(value, { [op.path[0]!]: op.value })
    }
    snapshot = { ...snapshot, value, revision: snapshot.revision! + 1 }
    publish()
    return true
  })
  const form: ConfigForm<SelectionConfigValues> = {
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    mutate,
    set: async () => false,
    unset: async () => false,
  }
  return {
    form, mutate,
    load: (value: SelectionConfigValues) => { snapshot = { ...snapshot, status: 'ready', value }; publish() },
    getValue: () => snapshot.value,
  }
}

function supervisionFormStub(options: { accept?: boolean; initial?: SupervisionConfigValues; loading?: boolean } = {}) {
  let snapshot: ConfigFormSnapshot<SupervisionConfigValues> = {
    status: options.loading ? 'loading' : 'ready',
    value: options.loading ? undefined : options.initial ?? { driftInterval: 6, noProgressRounds: 3, evidenceChars: 24000 },
    base: {}, user: {}, revision: 4, writable: true, mode: 'host',
  }
  const listeners = new Set<() => void>()
  const publish = () => { for (const listener of listeners) listener() }
  const mutate = vi.fn(async (ops: readonly { op: string; path: readonly string[]; value?: unknown }[], expectedRevision?: number) => {
    if (options.accept === false || expectedRevision !== snapshot.revision || snapshot.value === undefined) return false
    const value = { ...snapshot.value }
    for (const op of ops) {
      if (op.op === 'set') Object.assign(value, { [op.path[0]!]: op.value })
    }
    snapshot = { ...snapshot, value, revision: snapshot.revision! + 1 }
    publish()
    return true
  })
  const form: ConfigForm<SupervisionConfigValues> = {
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    mutate,
    set: async () => false,
    unset: async () => false,
  }
  return {
    form, mutate,
    load: (value: SupervisionConfigValues) => { snapshot = { ...snapshot, status: 'ready', value }; publish() },
    getValue: () => snapshot.value,
  }
}

function remoteStub(): JevPageRemote {
  return {
    listFeatures: vi.fn(async () => []),
    listRecords: vi.fn(async () => ({ items: [] })),
    getRecord: vi.fn(async () => null),
    testConnection: vi.fn(async connection => ({ connection, ok: true, latencyMs: 18, recordId: 'probe-1' })),
    getCredentialStatus: vi.fn(async connection => ({ connection, configured: true, writable: true, source: 'file' })),
    setCredential: vi.fn(async connection => ({ connection, configured: true, writable: true, source: 'file' })),
  }
}

function renderPage(form: ConfigForm<JevConfigValues>, jev: JevPageRemote, selectionForm?: ConfigForm<SelectionConfigValues>, notifySuccess: (message: string) => void = () => {}) {
  return render(<JevPage view="page" form={form} selectionForm={selectionForm} jev={jev} notifySuccess={notifySuccess} t={(key: JevLocaleKey) => en[key]} />)
}

describe('Jev bundle page', () => {
  it('edits bounded stage limits without changing the independent feature switch', async () => {
    const { form } = formStub()
    const jev = remoteStub()
    const value: StageNavigationConfigValues = { previousSteps: 2, previousChars: 700, maxRequestChars: 48000, concurrency: 1 }
    const snapshot: ConfigFormSnapshot<StageNavigationConfigValues> = {
      status: 'ready', value, base: {}, user: {}, revision: 4, writable: true, mode: 'host',
    }
    const mutate = vi.fn(async () => true)
    const stageNavigationForm: ConfigForm<StageNavigationConfigValues> = {
      getSnapshot: () => snapshot, subscribe: () => () => {}, mutate,
      set: async () => false, unset: async () => false,
    }
    render(<JevPage view="page" form={form} jev={jev} stageNavigationForm={stageNavigationForm} notifySuccess={() => {}} t={(key: JevLocaleKey) => en[key]} />)
    expect(await screen.findByText(en.stageSettingsHint)).toBeTruthy()
    fireEvent.change(screen.getByLabelText(en.stageConcurrency), { target: { value: '9' } })
    fireEvent.click(screen.getByRole('button', { name: en.saveStageSettings }))
    expect(screen.getByText(en.stageInvalid)).toBeTruthy()
    expect(mutate).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText(en.stageConcurrency), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText(en.previousSteps), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: en.saveStageSettings }))
    await waitFor(() => { expect(mutate).toHaveBeenCalledWith(expect.arrayContaining([
      { op: 'set', path: ['previousSteps'], value: 0 }, { op: 'set', path: ['concurrency'], value: 2 },
    ]), 4) })
    expect(form.getSnapshot().value?.features['stage-navigation']).toBeUndefined()
  })

  it('localizes the independent stage navigation feature in settings', async () => {
    const { form } = formStub()
    const jev = remoteStub()
    jev.listFeatures = vi.fn(async () => [{ id: 'stage-navigation', name: 'Stage navigation', description: 'Host description', enabled: false }])
    render(<JevPage view="page" form={form} jev={jev} notifySuccess={() => {}} t={(key: JevLocaleKey) => zh[key]} />)
    expect(await screen.findByText(zh.stageNavigationName)).toBeTruthy()
    expect(screen.getByText(zh.stageNavigationDescription)).toBeTruthy()
    expect(screen.getByRole('switch', { name: `${zh.enable} ${zh.stageNavigationName}` }).getAttribute('aria-checked')).toBe('false')
  })

  it('shows only credential status, writes a replacement, and runs one explicit diagnostic', async () => {
    const { form } = formStub()
    const jev = remoteStub()
    renderPage(form, jev)
    expect(await screen.findByText(en.noFeatures)).toBeTruthy()
    expect(screen.getByText(new RegExp(en.configured))).toBeTruthy()
    expect(screen.queryByDisplayValue('saved-secret')).toBeNull()

    fireEvent.change(screen.getByLabelText(new RegExp(en.apiKey)), { target: { value: 'new-secret' } })
    fireEvent.click(screen.getByRole('button', { name: en.replaceKey }))
    await waitFor(() => { expect(jev.setCredential).toHaveBeenCalledWith(resolveConnectionIdentity(form.getSnapshot().value!), 'new-secret') })
    expect(screen.queryByDisplayValue('new-secret')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: en.testConnection }))
    await waitFor(() => { expect(jev.testConnection).toHaveBeenCalledTimes(1) })
    expect(await screen.findByText(new RegExp(en.testSucceeded))).toBeTruthy()
  })

  it('checks a refused revision write and keeps a newly registered feature off', async () => {
    const { form, mutate } = formStub(false)
    const jev = remoteStub()
    jev.listFeatures = vi.fn(async () => [{ id: 'example', name: 'Example', description: 'Test feature', enabled: false }])
    renderPage(form, jev)
    expect(await screen.findByText('Example')).toBeTruthy()
    const toggle = screen.getByRole('switch', { name: `${en.enable} Example` })
    fireEvent.click(toggle)
    await waitFor(() => { expect(screen.getByText(en.featureSaveFailed, { exact: false })).toBeTruthy() })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(mutate).toHaveBeenCalledWith([{ op: 'set', path: ['features', 'example'], value: true }], 1)
  })

  it('preserves an unsaved connection edit when a feature switch changes the configuration revision', async () => {
    const { form } = formStub()
    const jev = remoteStub()
    jev.listFeatures = vi.fn(async () => [{ id: 'example', name: 'Example', description: 'Test feature', enabled: false }])
    renderPage(form, jev)
    expect(await screen.findByText('Example')).toBeTruthy()
    fireEvent.change(screen.getByLabelText(en.baseUrl), { target: { value: 'https://draft.invalid' } })
    fireEvent.click(screen.getByRole('switch', { name: `${en.enable} Example` }))
    await waitFor(() => { expect(screen.getByRole('switch', { name: `${en.disable} Example` })).toBeTruthy() })
    expect((screen.getByLabelText(en.baseUrl) as HTMLInputElement).value).toBe('https://draft.invalid')
  })

  it('refreshes the feature catalogue after a business plugin registers', async () => {
    const { form } = formStub()
    const jev = remoteStub()
    let registered = false
    jev.listFeatures = vi.fn(async () => registered ? [{ id: 'later', name: 'Later feature', description: 'Arrived after the page opened', enabled: false }] : [])
    renderPage(form, jev)
    expect(await screen.findByText(en.noFeatures)).toBeTruthy()
    registered = true
    fireEvent.click(screen.getByRole('button', { name: en.refreshFeatures }))
    expect(await screen.findByText('Later feature')).toBeTruthy()
  })

  it('keeps accepted rows after refresh fails and opens attempt and action details', async () => {
    const { form } = formStub()
    const jev = remoteStub()
    const summary: JevRecordSummary = {
      id: 'record-1', featureId: 'example', sessionId: 'session-1', status: 'succeeded',
      startedAt: '2026-09-26T00:00:00.000Z', updatedAt: '2026-09-26T00:00:01.000Z',
      attempts: 1, actionStatus: 'executed', diagnostic: false,
    }
    const detail: JevRecordDetail = {
      ...summary, link: { sessionId: 'session-1' },
      attemptRecords: [{
        id: 'attempt-1', startedAt: summary.startedAt, status: 'succeeded', latencyMs: 18,
        connection: { baseUrl: 'https://example.invalid', model: 'test-model', credentialRef: 'JEV_API_KEY' },
        request: { state: null, questions: [{ id: 'q1', kind: 'noul', prompt: 'Ready?' }] },
        rawResponse: { output: 'raw-answer' },
        response: { answers: [{ id: 'q1', kind: 'noul', probability: 0.9 }] },
        usage: { inputTokens: 4, outputTokens: 2 },
      }],
      receipts: [{ id: 'receipt-1', status: 'executed', at: summary.updatedAt }],
    }
    let calls = 0
    jev.listRecords = vi.fn(async () => {
      calls++
      if (calls > 1) throw new Error('temporary outage')
      return { items: [summary] }
    })
    jev.getRecord = vi.fn(async () => detail)
    renderPage(form, jev)
    fireEvent.click(screen.getByRole('tab', { name: en.records }))
    expect(await screen.findByText(/record-1|session-1/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.refresh }))
    expect(await screen.findByText(new RegExp(en.recordsFailed))).toBeTruthy()
    expect(screen.getByText(/session-1/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.details }))
    expect(await screen.findByText('null')).toBeTruthy()
    expect(screen.getByText(/raw-answer/)).toBeTruthy()
    expect(screen.getByText(/inputTokens/)).toBeTruthy()
    expect(screen.getByText(/test-model/)).toBeTruthy()
    expect(screen.getByText(/receipt-1/)).toBeTruthy()
  })

  it('drops a late detail response after changing record filters', async () => {
    const { form } = formStub()
    const jev = remoteStub()
    const summary: JevRecordSummary = {
      id: 'record-1', featureId: 'example', status: 'succeeded',
      startedAt: '2026-09-26T00:00:00.000Z', updatedAt: '2026-09-26T00:00:01.000Z',
      attempts: 1, diagnostic: false,
    }
    jev.listRecords = vi.fn(async () => ({ items: [summary] }))
    let settle: (detail: JevRecordDetail | null) => void = () => {}
    jev.getRecord = vi.fn(() => new Promise<JevRecordDetail | null>(resolve => { settle = resolve }))
    renderPage(form, jev)
    fireEvent.click(screen.getByRole('tab', { name: en.records }))
    expect(await screen.findByText('example')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.details }))
    fireEvent.change(screen.getByLabelText(en.feature), { target: { value: 'former-feature' } })
    fireEvent.click(screen.getByRole('button', { name: en.applyFilters }))
    expect(jev.listRecords).toHaveBeenLastCalledWith({ featureId: 'former-feature', limit: 25 })
    settle({ ...summary, link: {}, attemptRecords: [], receipts: [] })
    await waitFor(() => { expect(screen.queryByRole('button', { name: en.closeDetails })).toBeNull() })
  })
})

describe('Jev selection counts', () => {
  it('describes the glob bypass threshold and ranked display count', () => {
    const { form } = formStub()
    const selection = selectionFormStub()
    renderPage(form, remoteStub(), selection.form)
    expect(screen.getByText(en.selectionCountsHint)).toBeTruthy()
    expect(en.selectionCountsHint).toContain('more files')
    expect(en.selectionCountsHint).toContain('original glob result')
    expect(zh.selectionCountsHint).toContain('超过排序上限')
    expect(zh.selectionCountsHint).toContain('跳过判断排序')
    expect(en.rankedPathCount).toBe('Ranked paths shown')
    expect(zh.rankedPathCount).toBe('展示的已排序路径数')
  })

  it('shows saved profile values after the selection form loads', async () => {
    const { form } = formStub()
    const selection = selectionFormStub({ loading: true })
    renderPage(form, remoteStub(), selection.form)
    expect(screen.queryByLabelText(en.skillSummaryCount)).toBeNull()
    selection.load({ skillLimit: 8, fileCandidates: 60, fileLimit: 16 })
    await waitFor(() => { expect((screen.getByLabelText(en.skillSummaryCount) as HTMLInputElement).value).toBe('8') })
    expect((screen.getByLabelText(en.fileRankingMaximum) as HTMLInputElement).value).toBe('60')
    expect((screen.getByLabelText(en.rankedPathCount) as HTMLInputElement).value).toBe('16')
  })

  it('saves all three counts in one revision-aware mutation', async () => {
    const { form } = formStub()
    const selection = selectionFormStub()
    const notifySuccess = vi.fn()
    renderPage(form, remoteStub(), selection.form, notifySuccess)
    await waitFor(() => { expect((screen.getByLabelText(en.skillSummaryCount) as HTMLInputElement).value).toBe('5') })
    fireEvent.change(screen.getByLabelText(en.skillSummaryCount), { target: { value: '9' } })
    fireEvent.change(screen.getByLabelText(en.fileRankingMaximum), { target: { value: '50' } })
    fireEvent.change(screen.getByLabelText(en.rankedPathCount), { target: { value: '18' } })
    fireEvent.click(screen.getByRole('button', { name: en.saveSelectionCounts }))
    await waitFor(() => { expect(selection.mutate).toHaveBeenCalledTimes(1) })
    expect(selection.mutate).toHaveBeenCalledWith([
      { op: 'set', path: ['skillLimit'], value: 9 },
      { op: 'set', path: ['fileCandidates'], value: 50 },
      { op: 'set', path: ['fileLimit'], value: 18 },
    ], 4)
    expect(selection.getValue()).toEqual({ skillLimit: 9, fileCandidates: 50, fileLimit: 18 })
    expect(notifySuccess).toHaveBeenCalledWith(en.selectionCountSaved)
  })

  it('rejects empty, zero, negative, fractional, and unsafe counts without a write', async () => {
    const { form } = formStub()
    const selection = selectionFormStub()
    renderPage(form, remoteStub(), selection.form)
    await waitFor(() => { expect((screen.getByLabelText(en.skillSummaryCount) as HTMLInputElement).value).toBe('5') })
    for (const value of ['', '0', '-1', '1.5', '9007199254740992']) {
      fireEvent.change(screen.getByLabelText(en.skillSummaryCount), { target: { value } })
      fireEvent.click(screen.getByRole('button', { name: en.saveSelectionCounts }))
      expect(screen.getByLabelText(en.skillSummaryCount).getAttribute('aria-invalid')).toBe('true')
      expect(selection.mutate).not.toHaveBeenCalled()
    }
    expect(selection.getValue()).toEqual({ skillLimit: 5, fileCandidates: 40, fileLimit: 12 })
  })

  it('keeps edits and saved values when the form refuses a revision write', async () => {
    const { form } = formStub()
    const selection = selectionFormStub({ accept: false })
    renderPage(form, remoteStub(), selection.form)
    await waitFor(() => { expect((screen.getByLabelText(en.fileRankingMaximum) as HTMLInputElement).value).toBe('40') })
    fireEvent.change(screen.getByLabelText(en.fileRankingMaximum), { target: { value: '45' } })
    fireEvent.click(screen.getByRole('button', { name: en.saveSelectionCounts }))
    expect(await screen.findByText(en.selectionCountSaveFailed)).toBeTruthy()
    expect((screen.getByLabelText(en.fileRankingMaximum) as HTMLInputElement).value).toBe('45')
    expect(selection.getValue()?.fileCandidates).toBe(40)
    expect(selection.mutate).toHaveBeenCalledWith(expect.any(Array), 4)
  })

  it('preserves unsaved selection and connection edits across writes to the other form', async () => {
    const publicForm = formStub()
    const selection = selectionFormStub()
    const jev = remoteStub()
    jev.listFeatures = vi.fn(async () => [{ id: 'example', name: 'Example', description: 'Test feature', enabled: false }])
    renderPage(publicForm.form, jev, selection.form)
    expect(await screen.findByText('Example')).toBeTruthy()
    await waitFor(() => { expect((screen.getByLabelText(en.skillSummaryCount) as HTMLInputElement).value).toBe('5') })
    fireEvent.change(screen.getByLabelText(en.skillSummaryCount), { target: { value: '7' } })
    fireEvent.change(screen.getByLabelText(en.baseUrl), { target: { value: 'https://draft.invalid' } })
    fireEvent.click(screen.getByRole('switch', { name: `${en.enable} Example` }))
    await waitFor(() => { expect(screen.getByRole('switch', { name: `${en.disable} Example` })).toBeTruthy() })
    expect((screen.getByLabelText(en.skillSummaryCount) as HTMLInputElement).value).toBe('7')
    fireEvent.click(screen.getByRole('button', { name: en.saveSelectionCounts }))
    await waitFor(() => { expect(selection.getValue()?.skillLimit).toBe(7) })
    expect((screen.getByLabelText(en.baseUrl) as HTMLInputElement).value).toBe('https://draft.invalid')
    expect(publicForm.form.getSnapshot().value?.baseUrl).toBe('https://example.invalid')
    expect(publicForm.form.getSnapshot().value?.features.example).toBe(true)
    expect(publicForm.mutate).toHaveBeenCalledTimes(1)
  })
})


describe('Jev supervision settings', () => {
  it('toggles one feature independently, validates counts, and reloads accepted profile values', async () => {
    const { form } = formStub()
    const counts = supervisionFormStub()
    const jev = remoteStub()
    jev.listFeatures = vi.fn(async () => ['drift-monitoring', 'completion-check', 'goal-supervision'].map(id => ({ id, name: id, description: id, enabled: false })))
    const draw = () => render(<JevPage view="page" form={form} supervisionForm={counts.form} jev={jev} notifySuccess={() => {}} t={(key: JevLocaleKey) => en[key]} />)
    const mounted = draw()
    expect((await screen.findAllByRole('switch')).every(element => element.getAttribute('aria-checked') === 'false')).toBe(true)
    fireEvent.click(screen.getByRole('switch', { name: 'Enable completion-check' }))
    await waitFor(() => expect(form.getSnapshot().value?.features).toEqual({ 'completion-check': true }))
    expect(screen.getByRole('switch', { name: 'Enable drift-monitoring' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('switch', { name: 'Enable goal-supervision' }).getAttribute('aria-checked')).toBe('false')
    expect((screen.getByLabelText(en.driftInterval) as HTMLInputElement).value).toBe('6')
    expect((screen.getByLabelText(en.noProgressRounds) as HTMLInputElement).value).toBe('3')
    fireEvent.change(screen.getByLabelText(en.driftInterval), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: en.saveSupervisionCounts }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(counts.mutate).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText(en.driftInterval), { target: { value: '9' } })
    fireEvent.change(screen.getByLabelText(en.noProgressRounds), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: en.saveSupervisionCounts }))
    await waitFor(() => expect(counts.getValue()).toEqual({ driftInterval: 9, noProgressRounds: 4, evidenceChars: 24000 }))
    mounted.unmount(); draw()
    expect((screen.getByLabelText(en.driftInterval) as HTMLInputElement).value).toBe('9')
    expect((screen.getByLabelText(en.noProgressRounds) as HTMLInputElement).value).toBe('4')
    expect((await screen.findByRole('switch', { name: 'Disable completion-check' })).getAttribute('aria-checked')).toBe('true')
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function selectedInput(label: string): HTMLInputElement { return screen.getByLabelText(label) as HTMLInputElement }

function selectLuna(api: 'openrouter' | 'openai') {
  fireEvent.change(screen.getByLabelText(en.decisionModel), { target: { value: 'luna' } })
  fireEvent.change(screen.getByLabelText(en.lunaApi), { target: { value: api } })
}

describe('saved Jev and Luna connections', () => {
  it('defaults a legacy configuration to Jev while retaining its custom values', async () => {
    const legacy = clientConfig({ baseUrl: 'https://legacy.invalid/systemone', model: 'custom-jev', credentialRef: 'LEGACY_KEY', timeoutMs: 12345 })
    for (const field of ['judgmentModel', 'lunaApi', 'lunaOpenRouterBaseUrl', 'lunaOpenRouterCredentialRef', 'lunaOpenAIBaseUrl', 'lunaOpenAICredentialRef']) Reflect.deleteProperty(legacy, field)
    const { form } = formStub(true, legacy)
    const jev = remoteStub()
    renderPage(form, jev)
    await waitFor(() => { expect(jev.getCredentialStatus).toHaveBeenCalledTimes(1) })
    expect(selectedInput(en.decisionModel).value).toBe('jev')
    expect(selectedInput(en.baseUrl).value).toBe(legacy.baseUrl)
    expect(selectedInput(en.model).value).toBe('custom-jev')
    expect(selectedInput(en.timeoutMs).value).toBe('12345')
    selectLuna('openrouter')
    expect(selectedInput(en.baseUrl).value).toBe('https://openrouter.ai/api/alpha/decisions')
    expect(selectedInput(en.credentialRef).value).toBe('JEV_LUNA_OPENROUTER_API_KEY')
    expect(selectedInput(en.model).readOnly).toBe(true)
    expect(selectedInput(en.model).value).toBe('openai/gpt-6-luna-decisions')
    expect(jev.testConnection).not.toHaveBeenCalled()
    expect(jev.setCredential).not.toHaveBeenCalled()
  })

  it('saves and restores all three connections without changing feature switches or shared limits', async () => {
    const initial = clientConfig({ features: { example: true, 'test-log-admission': false }, timeoutMs: 24000 })
    const { form, mutate } = formStub(true, initial)
    const selection = selectionFormStub({ initial: { skillLimit: 8, fileCandidates: 77, fileLimit: 19 } })
    const jev = remoteStub()
    renderPage(form, jev, selection.form)
    await screen.findByText(en.noFeatures)
    for (const api of ['openrouter', 'openai'] as const) {
      selectLuna(api)
      fireEvent.change(screen.getByLabelText(en.baseUrl), { target: { value: `https://${api}.invalid/decisions` } })
      fireEvent.change(screen.getByLabelText(en.credentialRef), { target: { value: `${api.toUpperCase()}_JUDGE_KEY` } })
      fireEvent.click(screen.getByRole('button', { name: en.saveConnection }))
      await waitFor(() => { expect(form.getSnapshot().value?.lunaApi).toBe(api); expect((screen.getByRole('button', { name: en.saveConnection }) as HTMLButtonElement).disabled).toBe(true) })
      await waitFor(() => { expect(jev.getCredentialStatus).toHaveBeenCalledWith(resolveConnectionIdentity(form.getSnapshot().value!)) })
      expect(selectedInput(en.model).value).toBe(api === 'openrouter' ? 'openai/gpt-6-luna-decisions' : 'gpt-6-luna')
    }
    fireEvent.change(screen.getByLabelText(en.decisionModel), { target: { value: 'jev' } })
    expect(selectedInput(en.baseUrl).value).toBe(initial.baseUrl)
    expect(selectedInput(en.model).value).toBe(initial.model)
    fireEvent.click(screen.getByRole('button', { name: en.saveConnection }))
    await waitFor(() => { expect(form.getSnapshot().value?.judgmentModel).toBe('jev') })
    expect(form.getSnapshot().value).toMatchObject({ features: initial.features, timeoutMs: 24000,
      lunaOpenRouterBaseUrl: 'https://openrouter.invalid/decisions', lunaOpenRouterCredentialRef: 'OPENROUTER_JUDGE_KEY',
      lunaOpenAIBaseUrl: 'https://openai.invalid/decisions', lunaOpenAICredentialRef: 'OPENAI_JUDGE_KEY' })
    expect(mutate.mock.calls.every(([ops]) => ops.every(op => op.path[0] !== 'features'))).toBe(true)
    expect(selectedInput(en.skillSummaryCount).value).toBe('8')
    expect(selectedInput(en.fileRankingMaximum).value).toBe('77')
    expect(selectedInput(en.rankedPathCount).value).toBe('19')
    expect(selection.mutate).not.toHaveBeenCalled()
    expect(jev.testConnection).not.toHaveBeenCalled()
    expect(jev.setCredential).not.toHaveBeenCalled()
  })

  it('keeps a refused connection draft and blocks unsaved key writes and diagnostics', async () => {
    const { form } = formStub(false)
    const jev = remoteStub()
    renderPage(form, jev)
    await screen.findByText(en.noFeatures)
    selectLuna('openai')
    fireEvent.change(screen.getByLabelText(en.credentialRef), { target: { value: 'DRAFT_KEY' } })
    fireEvent.click(screen.getByRole('button', { name: en.saveConnection }))
    expect(await screen.findByText(en.saveFailed)).toBeTruthy()
    expect(selectedInput(en.lunaApi).value).toBe('openai')
    expect(selectedInput(en.credentialRef).value).toBe('DRAFT_KEY')
    expect(form.getSnapshot().value?.judgmentModel).toBe('jev')
    expect((screen.getByRole('button', { name: en.testConnection }) as HTMLButtonElement).disabled).toBe(true)
    expect(selectedInput(en.apiKey).disabled).toBe(true)
    expect(jev.testConnection).not.toHaveBeenCalled()
    expect(jev.setCredential).not.toHaveBeenCalled()
  })

  it('ignores a late credential status from a previous channel', async () => {
    const { form, update } = formStub()
    const oldConnection = resolveConnectionIdentity(form.getSnapshot().value!)
    const pending = deferred<JevCredentialStatus>()
    const jev = remoteStub()
    jev.getCredentialStatus = vi.fn(async connection => connection.connectionId === 'jev' ? pending.promise : { connection, configured: false, writable: true })
    renderPage(form, jev)
    await waitFor(() => { expect(jev.getCredentialStatus).toHaveBeenCalledWith(oldConnection) })
    act(() => { update({ judgmentModel: 'luna', lunaApi: 'openai' }) })
    await screen.findByText(new RegExp(en.missing))
    await act(async () => { pending.resolve({ connection: oldConnection, configured: true, writable: false }); await pending.promise })
    expect(screen.queryByText(new RegExp(en.configured))).toBeNull()
    expect(selectedInput(en.apiKey).disabled).toBe(false)
    expect(selectedInput(en.model).value).toBe('gpt-6-luna')
  })

  it.each([
    { judgmentModel: 'luna' as const, lunaApi: 'openai' as const },
    { credentialRef: 'CHANGED_JEV_KEY' },
  ])('keeps new input after a late key completion when saved settings change: %j', async changes => {
    const { form, update } = formStub()
    const oldConnection = resolveConnectionIdentity(form.getSnapshot().value!)
    const pending = deferred<JevCredentialStatus>()
    const jev = remoteStub()
    jev.setCredential = vi.fn(async () => pending.promise)
    renderPage(form, jev)
    await screen.findByText(new RegExp(en.configured))
    fireEvent.change(screen.getByLabelText(new RegExp(en.apiKey)), { target: { value: 'old-input' } })
    fireEvent.click(screen.getByRole('button', { name: en.replaceKey }))
    await waitFor(() => { expect(jev.setCredential).toHaveBeenCalledWith(oldConnection, 'old-input') })
    act(() => { update(changes) })
    await screen.findByText(new RegExp(en.configured))
    fireEvent.change(screen.getByLabelText(new RegExp(en.apiKey)), { target: { value: 'new-input' } })
    await act(async () => { pending.resolve({ connection: oldConnection, configured: true, writable: true }); await pending.promise })
    expect(screen.getByDisplayValue('new-input')).toBeTruthy()
    expect(jev.setCredential).toHaveBeenCalledTimes(1)
  })

  it('aborts an old probe and retains the new channel result after the old response arrives', async () => {
    const { form, update } = formStub(true, clientConfig({ judgmentModel: 'luna' }))
    const oldConnection = resolveConnectionIdentity(form.getSnapshot().value!)
    const pending = deferred<JevProbeResult>()
    const jev = remoteStub()
    jev.testConnection = vi.fn(async connection => connection.connectionId === 'luna-openrouter' ? pending.promise : { connection, ok: true, latencyMs: 57, recordId: 'new-probe' })
    renderPage(form, jev)
    await screen.findByText(en.noFeatures)
    fireEvent.click(screen.getByRole('button', { name: en.testConnection }))
    await waitFor(() => { expect(jev.testConnection).toHaveBeenCalledTimes(1) })
    const oldSignal = vi.mocked(jev.testConnection).mock.calls[0]![1]
    act(() => { update({ lunaApi: 'openai' }) })
    await waitFor(() => { expect(oldSignal.aborted).toBe(true); expect(selectedInput(en.model).value).toBe('gpt-6-luna') })
    fireEvent.click(screen.getByRole('button', { name: en.testConnection }))
    await screen.findByText(/57 ms/)
    await act(async () => { pending.resolve({ connection: oldConnection, ok: true, latencyMs: 999, recordId: 'old-probe' }); await pending.promise })
    expect(screen.queryByText(/999 ms/)).toBeNull()
    expect(screen.getByText(/57 ms/)).toBeTruthy()
    expect(jev.testConnection).toHaveBeenLastCalledWith(resolveConnectionIdentity(form.getSnapshot().value!), expect.any(AbortSignal))
  })

  it('rejects a result with a different saved identity and retains the replacement input', async () => {
    const { form } = formStub()
    const jev = remoteStub()
    const notifySuccess = vi.fn()
    jev.setCredential = vi.fn(async connection => ({ connection: { ...connection, credentialRef: 'OTHER_REF' }, configured: true, writable: true }))
    renderPage(form, jev, undefined, notifySuccess)
    await screen.findByText(new RegExp(en.configured))
    fireEvent.change(screen.getByLabelText(new RegExp(en.apiKey)), { target: { value: 'replacement' } })
    fireEvent.click(screen.getByRole('button', { name: en.replaceKey }))
    await screen.findByText(en.connectionChanged)
    expect(screen.getByDisplayValue('replacement')).toBeTruthy()
    expect(notifySuccess).not.toHaveBeenCalled()
  })

  it('retains a draft when a late accepted save no longer matches the current saved settings', async () => {
    const { form, mutate, update } = formStub()
    const pending = deferred<boolean>()
    mutate.mockImplementationOnce(async () => pending.promise)
    const jev = remoteStub()
    renderPage(form, jev)
    await screen.findByText(en.noFeatures)
    fireEvent.change(screen.getByLabelText(en.baseUrl), { target: { value: 'https://draft.invalid' } })
    fireEvent.click(screen.getByRole('button', { name: en.saveConnection }))
    await waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    act(() => { update({ baseUrl: 'https://elsewhere.invalid' }) })
    await act(async () => { pending.resolve(true); await pending.promise })
    expect(await screen.findByText(en.connectionChanged)).toBeTruthy()
    expect(selectedInput(en.baseUrl).value).toBe('https://draft.invalid')
    expect(form.getSnapshot().value?.baseUrl).toBe('https://elsewhere.invalid')
  })

  it('localizes both Luna selectors and the fixed model explanation in Chinese', async () => {
    const { form } = formStub(true, clientConfig({ judgmentModel: 'luna', lunaApi: 'openai' }))
    render(<JevPage view="page" form={form} jev={remoteStub()} notifySuccess={() => {}} t={(key: JevLocaleKey) => zh[key]} />)
    expect(await screen.findByText(zh.noFeatures)).toBeTruthy()
    expect(selectedInput(zh.decisionModel).value).toBe('luna')
    expect(selectedInput(zh.lunaApi).value).toBe('openai')
    expect(screen.getByText(zh.lunaModelHint)).toBeTruthy()
    expect(screen.getByText(zh.diagnosticHint)).toBeTruthy()
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('shows actual provider packets separately from normalized answers and retains legacy records', async () => {
    const { form } = formStub()
    const jev = remoteStub()
    const raw = { id: 'official-request', model: 'gpt-6-luna-reported', answers: [{ name: 'ready', type: 'predicate', probability: 0.8 }] }
    const record: JevRecordDetail = {
      id: 'luna-record', featureId: 'example', diagnostic: true, status: 'succeeded', startedAt: '2026-10-07T00:00:00Z', updatedAt: '2026-10-07T00:00:01Z', attempts: 2,
      link: {}, receipts: [], attemptRecords: [
        { id: 'legacy', startedAt: '2026-09-26T00:00:00Z', status: 'failed', connection: { baseUrl: 'https://legacy.invalid', model: 'legacy-model', credentialRef: 'LEGACY_REF' }, request: { state: {}, questions: [] } },
        { id: 'official', startedAt: '2026-10-07T00:00:00Z', status: 'succeeded', connection: { connectionId: 'luna-openai', baseUrl: 'https://api.openai.com/v1/decisions', model: 'gpt-6-luna', credentialRef: 'LUNA_REF' },
          request: { state: { original: 'full-input' }, questions: [{ id: 'ready', kind: 'noul', prompt: 'Ready?' }] }, rawResponse: raw,
          response: { answers: [{ id: 'ready', kind: 'noul', probability: 0.8 }] }, usageComplete: false,
          networkRecords: [{ id: 'packet-1', questionIds: ['ready'], startedAt: '2026-10-07T00:00:00Z', status: 'succeeded', httpStatus: 200,
            requestBody: { input: '{"original":"full-input"}', questions: [{ name: 'ready', type: 'predicate', instruction: 'Ready?' }] }, rawResponse: raw, rawResponseText: JSON.stringify(raw), returnedModel: raw.model, requestId: raw.id, usage: { inputTokens: 12 } }],
        },
      ],
    }
    jev.listRecords = vi.fn(async () => ({ items: [record] }))
    jev.getRecord = vi.fn(async () => record)
    renderPage(form, jev)
    fireEvent.click(screen.getByRole('tab', { name: en.records }))
    fireEvent.click(await screen.findByRole('button', { name: en.details }))
    await screen.findByText(en.providerRequests)
    expect(screen.getByText(JSON.stringify(raw))).toBeTruthy()
    expect(screen.getByText(en.usageIncomplete)).toBeTruthy()
    expect(screen.getByText(en.requestBody).nextElementSibling?.textContent).toContain('"type": "predicate"')
    expect(screen.getByText(en.answer).nextElementSibling?.textContent).toContain('"kind": "noul"')
    expect(screen.getByText(en.reportedModel).nextElementSibling?.textContent).toContain('gpt-6-luna-reported')
    expect(screen.getAllByText(en.connectionIdentity)[0]?.nextElementSibling?.textContent).toContain('legacy-model')
    expect(screen.getAllByText(en.connectionIdentity)[0]?.nextElementSibling?.textContent).not.toContain('connectionId')
  })
})

it('keeps edited fields while accepting a new saved value for an unedited hidden connection', async () => {
  const { form, update } = formStub()
  const jev = remoteStub()
  renderPage(form, jev)
  await screen.findByText(en.noFeatures)
  fireEvent.change(screen.getByLabelText(en.baseUrl), { target: { value: 'https://jev-draft.invalid' } })
  act(() => { update({ lunaOpenAIBaseUrl: 'https://latest-official.invalid/decisions' }) })
  expect(selectedInput(en.baseUrl).value).toBe('https://jev-draft.invalid')
  fireEvent.click(screen.getByRole('button', { name: en.saveConnection }))
  await waitFor(() => { expect(form.getSnapshot().value?.baseUrl).toBe('https://jev-draft.invalid') })
  expect(form.getSnapshot().value?.lunaOpenAIBaseUrl).toBe('https://latest-official.invalid/decisions')
})
