import { clientConfig } from './client-fixtures.ts'
/** Independent feature switch owns the stage tab's lifetime. */

import { describe, expect, it, vi } from 'vitest'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { JevConfigValues } from '../src/client/JevPage.tsx'
import { watchStageView } from '../src/client/stage-registration.ts'

function form() {
  let snapshot: ConfigFormSnapshot<JevConfigValues> = {
    status: 'ready', value: clientConfig({ baseUrl: '', model: '', credentialRef: '' }),
    base: {}, user: {}, revision: 1, writable: true, mode: 'host',
  }
  const listeners = new Set<() => void>()
  const source: Pick<ConfigForm<JevConfigValues>, 'getSnapshot' | 'subscribe'> = {
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  return {
    source,
    setEnabled: (enabled: boolean) => {
      snapshot = { ...snapshot, value: { ...snapshot.value!, features: { 'stage-navigation': enabled } }, revision: snapshot.revision! + 1 }
      for (const listener of listeners) listener()
    },
  }
}

describe('stage navigation tab registration', () => {
  it('stays absent by default, follows only its own switch, and disposes on unload', () => {
    const state = form()
    const disposeView = vi.fn()
    const register = vi.fn(() => disposeView)
    const unload = watchStageView(state.source, register)
    expect(register).not.toHaveBeenCalled()

    state.setEnabled(true)
    expect(register).toHaveBeenCalledTimes(1)
    state.setEnabled(true)
    expect(register).toHaveBeenCalledTimes(1)

    state.setEnabled(false)
    expect(disposeView).toHaveBeenCalledTimes(1)
    state.setEnabled(true)
    expect(register).toHaveBeenCalledTimes(2)

    unload()
    expect(disposeView).toHaveBeenCalledTimes(2)
    state.setEnabled(true)
    expect(register).toHaveBeenCalledTimes(2)
  })
})
