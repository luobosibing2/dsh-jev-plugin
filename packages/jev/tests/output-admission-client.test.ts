// @vitest-environment jsdom
/** Output admission settings through the published Jev page and ConfigForm seams. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import type { ButtonHTMLAttributes } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { JevPage, type JevConfigValues, type JevPageRemote } from '../src/client/JevPage.tsx'
import { clientConfig } from './client-fixtures.ts'
import { en, type JevLocaleKey } from '../src/client/locales.ts'
import type { OutputAdmissionConfigValues } from '../src/output-admission-types.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ children, variant: _variant, size: _size, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) =>
    React.createElement('button', { type: 'button', ...props }, children),
  SegmentedTabs: ({ items, value, onChange, label }: { items: readonly { value: string; label: string }[]; value: string; onChange: (value: 'settings' | 'records') => void; label: string }) =>
    React.createElement('div', { role: 'tablist', 'aria-label': label }, ...items.map(item =>
      React.createElement('button', { type: 'button', role: 'tab', 'aria-selected': value === item.value, key: item.value,
        onClick: () => { onChange(item.value as 'settings' | 'records') } }, item.label))),
  StateDot: () => React.createElement('span', { 'aria-hidden': true }),
  Switch: ({ checked, onChange, label, disabled }: { checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean }) =>
    React.createElement('button', { type: 'button', role: 'switch', 'aria-label': label, 'aria-checked': checked, disabled,
      onClick: () => { onChange(!checked) } }),
}))

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const limits: OutputAdmissionConfigValues = {
  generalMinChars: 6000, testMinChars: 4000, generalBlockChars: 1200,
  maxGeneralBlocks: 48, maxTestCandidates: 24, maxRequestChars: 48000,
  maxTaskChars: 12000, waitMs: 4000, omitProbability: 0.8,
  minSavedChars: 300, minSavedRatio: 0.1, slowTestMs: 300,
  duplicateMinLines: 6, duplicateMinChars: 200,
}

function formStub<T extends object>(initial: T, accept: boolean = true) {
  let snapshot: ConfigFormSnapshot<T> = {
    status: 'ready', value: structuredClone(initial), base: {}, user: {}, revision: 3, writable: true, mode: 'host',
  }
  const listeners = new Set<() => void>()
  const mutate = vi.fn(async (ops: readonly { op: string; path: readonly string[]; value?: unknown }[], revision?: number) => {
    if (!accept || revision !== snapshot.revision || snapshot.value === undefined) return false
    const next = structuredClone(snapshot.value) as Record<string, unknown>
    for (const op of ops) {
      if (op.op !== 'set') continue
      if (op.path[0] === 'features' && op.path[1] !== undefined) {
        const features = next.features as Record<string, boolean>
        features[op.path[1]] = Boolean(op.value)
      } else if (op.path[0] !== undefined) next[op.path[0]] = op.value
    }
    snapshot = { ...snapshot, value: next as T, revision: snapshot.revision! + 1 }
    for (const listener of listeners) listener()
    return true
  })
  const form: ConfigForm<T> = {
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    mutate, set: async () => false, unset: async () => false,
  }
  return { form, mutate, value: () => snapshot.value }
}

function remoteStub(): JevPageRemote {
  return {
    listFeatures: vi.fn(async () => [
      { id: 'output-admission', name: 'Long log noise removal', description: 'Command logs', enabled: false },
      { id: 'test-log-admission', name: 'Test log noise removal', description: 'Test logs', enabled: false },
    ]),
    listRecords: vi.fn(async () => ({ items: [] })), getRecord: vi.fn(async () => null),
    testConnection: vi.fn(async connection => ({ connection, ok: true, latencyMs: 1, recordId: 'fixture-probe' })),
    getCredentialStatus: vi.fn(async connection => ({ connection, configured: false, writable: true })),
    setCredential: vi.fn(async connection => ({ connection, configured: true, writable: true })),
  }
}

function setup(accept = true) {
  const publicForm = formStub<JevConfigValues>(clientConfig({
    baseUrl: 'https://fixture.invalid', model: 'fixture', credentialRef: 'FIXTURE_KEY', timeoutMs: 10000, features: {},
  }))
  const outputForm = formStub(limits, accept)
  const notifySuccess = vi.fn()
  render(React.createElement(JevPage, { view: 'page', form: publicForm.form, outputAdmissionForm: outputForm.form,
    jev: remoteStub(), notifySuccess, t: (key: JevLocaleKey) => en[key] }))
  return { publicForm, outputForm, notifySuccess }
}

describe('output admission profile settings', () => {
  it('renders saved budgets and saves edits without enabling either feature', async () => {
    const h = setup()
    expect((screen.getByLabelText(en.generalMinChars) as HTMLInputElement).value).toBe('6000')
    expect((screen.getByLabelText(en.testMinChars) as HTMLInputElement).value).toBe('4000')
    expect((screen.getByLabelText(en.omitProbability) as HTMLInputElement).value).toBe('0.8')
    expect(screen.getByText(en.outputAdmissionHint)).toBeTruthy()
    const first = await screen.findByRole('switch', { name: `${en.enable} Long log noise removal` })
    const second = screen.getByRole('switch', { name: `${en.enable} Test log noise removal` })
    expect(first.getAttribute('aria-checked')).toBe('false')
    expect(second.getAttribute('aria-checked')).toBe('false')
    fireEvent.change(screen.getByLabelText(en.generalMinChars), { target: { value: '7000' } })
    fireEvent.change(screen.getByLabelText(en.omitProbability), { target: { value: '0.95' } })
    fireEvent.click(screen.getByRole('button', { name: en.saveOutputAdmission }))
    await waitFor(() => { expect(h.outputForm.mutate).toHaveBeenCalledTimes(1) })
    expect(h.outputForm.mutate).toHaveBeenCalledWith(expect.arrayContaining([
      { op: 'set', path: ['generalMinChars'], value: 7000 },
      { op: 'set', path: ['omitProbability'], value: 0.95 },
    ]), 3)
    expect(h.outputForm.mutate.mock.calls[0]?.[0]).toHaveLength(Object.keys(limits).length)
    expect(h.outputForm.value()).toMatchObject({ generalMinChars: 7000, omitProbability: 0.95 })
    expect(h.publicForm.mutate).not.toHaveBeenCalled()
    expect(h.publicForm.value()?.features).toEqual({})
    expect(h.notifySuccess).toHaveBeenCalledWith(en.outputAdmissionSaved)
  })

  it('keeps the two switches independent across a budget save', async () => {
    const h = setup()
    const first = await screen.findByRole('switch', { name: `${en.enable} Long log noise removal` })
    fireEvent.click(first)
    await waitFor(() => { expect(h.publicForm.value()?.features).toEqual({ 'output-admission': true }) })
    expect(screen.getByRole('switch', { name: `${en.enable} Test log noise removal` }).getAttribute('aria-checked')).toBe('false')
    fireEvent.change(screen.getByLabelText(en.testMinChars), { target: { value: '4500' } })
    fireEvent.click(screen.getByRole('button', { name: en.saveOutputAdmission }))
    await waitFor(() => { expect(h.outputForm.value()?.testMinChars).toBe(4500) })
    expect(h.publicForm.value()?.features).toEqual({ 'output-admission': true })
    expect(h.publicForm.mutate).toHaveBeenCalledTimes(1)
    expect(h.publicForm.mutate).toHaveBeenCalledWith([{ op: 'set', path: ['features', 'output-admission'], value: true }], 3)
  })

  it('rejects an invalid probability and fractional integer without writing', async () => {
    const h = setup()
    const probability = screen.getByLabelText(en.omitProbability)
    fireEvent.change(probability, { target: { value: '1.2' } })
    fireEvent.click(screen.getByRole('button', { name: en.saveOutputAdmission }))
    expect(probability.getAttribute('aria-invalid')).toBe('true')
    expect(h.outputForm.mutate).not.toHaveBeenCalled()
    fireEvent.change(probability, { target: { value: '0.8' } })
    const blocks = screen.getByLabelText(en.maxGeneralBlocks)
    fireEvent.change(blocks, { target: { value: '4.5' } })
    fireEvent.click(screen.getByRole('button', { name: en.saveOutputAdmission }))
    expect(blocks.getAttribute('aria-invalid')).toBe('true')
    expect(h.outputForm.mutate).not.toHaveBeenCalled()
  })

  it('shows a failed save and preserves the unsaved budget edit', async () => {
    const h = setup(false)
    const minimum = screen.getByLabelText(en.generalMinChars) as HTMLInputElement
    fireEvent.change(minimum, { target: { value: '7500' } })
    fireEvent.click(screen.getByRole('button', { name: en.saveOutputAdmission }))
    expect(await screen.findByText(en.outputAdmissionSaveFailed)).toBeTruthy()
    expect(minimum.value).toBe('7500')
    expect(h.outputForm.value()?.generalMinChars).toBe(6000)
    expect(h.notifySuccess).not.toHaveBeenCalled()
  })
})
