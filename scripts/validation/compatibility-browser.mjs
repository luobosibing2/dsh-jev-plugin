/** Verify the installed Jev Client through its authenticated official Web UI. */
import assert from 'node:assert/strict'

/**
 * Remove Web authentication tokens from saved browser and Host facts.
 * @param text - Browser or Host text that can contain the authentication URL.
 * @returns Text with query authentication tokens removed.
 */
export function redactWebSecrets(text) {
  return String(text).replace(/([?&]token=)[^&#\s"'<>]+/gi, '$1[REDACTED_SECRET]')
}

/**
 * Verify installed settings, records and classified Session steps in a private browser context.
 * @param options - Authenticated Host URL, disposable settings and the classified fixture snapshot.
 * @returns Sanitized browser observations, including any failed phase.
 */
export async function checkCompatibilityBrowser({ url, endpoint, model, timeoutMs, featureCount, stageSnapshot }) {
  const result = { ok: false, pageErrors: [], consoleErrors: [], importErrors: [] }
  let phase = 'playwright-import'
  let browser, context, page, timer
  let onPageError, onConsole, onRequestFailed, onResponse
  try {
    const { chromium } = await import('playwright')
    phase = 'browser-launch'
    browser = await chromium.launch({ headless: true, timeout: 30_000 })
    result.browserVersion = browser.version()
    context = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 1000 } })
    page = await context.newPage()
    page.setDefaultTimeout(30_000)
    let failBrowser
    const browserFailure = new Promise((_, reject) => { failBrowser = reject })
    const fail = (kind, message) => {
      result[kind].push(redactWebSecrets(message))
      const error = new Error(kind + ': ' + redactWebSecrets(message))
      error.code = 'CLIENT_BOOTSTRAP_ERROR'
      failBrowser(error)
    }
    onPageError = error => fail('pageErrors', error.message)
    onConsole = message => { if (message.type() === 'error') fail('consoleErrors', message.text()) }
    onRequestFailed = request => {
      if (request.resourceType() === 'script') fail('importErrors', request.url() + ': ' + request.failure()?.errorText)
    }
    onResponse = response => {
      if (response.request().resourceType() === 'script' && response.status() >= 400) fail('importErrors', response.url() + ': HTTP ' + response.status())
    }
    page.on('pageerror', onPageError)
    page.on('console', onConsole)
    page.on('requestfailed', onRequestFailed)
    page.on('response', onResponse)
    timer = setTimeout(() => {
      const error = new Error('Browser verification exceeded 90 seconds')
      error.code = 'BROWSER_TIMEOUT'
      failBrowser(error)
    }, 90_000)
    const verify = async () => {
      phase = 'client-bootstrap'
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      assert(response?.ok(), 'Authenticated official Web page must return HTTP success')
      const plugins = page.getByRole('button', { name: /^(Plugins|插件)$/ })
      await plugins.waitFor({ state: 'visible' })
      result.clientBootstrap = true
      result.onboarding = { noticeAcknowledged: false, apiKeyDeferred: false }
      const notice = page.getByRole('dialog', { name: /^(Preview Notice|Internal Testing Notice|预览版说明|内测声明)$/ })
      const credentialSetup = page.getByRole('dialog', { name: /^(Add an API key to get started|添加一个 API Key 开始使用)$/ })
      await page.addLocatorHandler(notice, async () => {
        const resumePhase = phase
        phase = 'web-onboarding'
        await notice.getByRole('button', { name: /^(Continue|继续)$/ }).click()
        result.onboarding.noticeAcknowledged = true
        phase = resumePhase
      }, { times: 1 })
      await page.addLocatorHandler(credentialSetup, async () => {
        const resumePhase = phase
        phase = 'web-onboarding'
        await credentialSetup.getByRole('button', { name: /^(Configure later|稍后配置)$/ }).click()
        result.onboarding.apiKeyDeferred = true
        phase = resumePhase
      }, { times: 1 })
      phase = 'plugins-navigation'
      await plugins.click()
      const card = page.locator('[data-plugin-package="@dsh-jev/plugin"]')
      await card.waitFor({ state: 'visible' })
      await card.getByRole('button', { name: /^(View|查看) @dsh-jev\/plugin$/ }).click()
      await page.locator('[data-plugin-detail="@dsh-jev/plugin"]').waitFor({ state: 'visible' })
      result.entryVisible = true
      phase = 'jev-settings'
      const settings = page.locator('#jev-settings-panel')
      await settings.waitFor({ state: 'visible' })
      await page.locator('#jev-settings-tab').waitFor({ state: 'visible' })
      await settings.getByRole('textbox', { name: /^(Service address|服务地址)$/ }).waitFor({ state: 'visible' })
      await settings.getByRole('textbox', { name: /^(Model|模型)$/ }).waitFor({ state: 'visible' })
      await settings.getByRole('spinbutton', { name: /^(Timeout \(ms\)|超时（毫秒）)$/ }).waitFor({ state: 'visible' })
      await page.waitForFunction(expected => {
        const panel = document.querySelector('#jev-settings-panel')
        const inputs = [...(panel?.querySelectorAll('input') ?? [])].map(input => input.value)
        const switches = [...(panel?.querySelectorAll('[role="switch"]') ?? [])]
        return inputs.includes(expected.endpoint) && inputs.includes(expected.model) && inputs.includes(String(expected.timeoutMs))
          && switches.length === expected.featureCount && switches.every(control => control.getAttribute('aria-checked') === 'true')
      }, { endpoint, model, timeoutMs, featureCount })
      assert.equal(await settings.getByRole('alert').count(), 0, 'Jev settings must load without an error notice')
      result.settingsVisible = true
      result.settings = {
        baseUrl: await settings.getByRole('textbox', { name: /^(Service address|服务地址)$/ }).inputValue(),
        model: await settings.getByRole('textbox', { name: /^(Model|模型)$/ }).inputValue(),
        timeoutMs: Number(await settings.getByRole('spinbutton', { name: /^(Timeout \(ms\)|超时（毫秒）)$/ }).inputValue()),
        featureCount: await settings.getByRole('switch').count(),
        enabledFeatureCount: await settings.locator('[role="switch"][aria-checked="true"]').count(),
      }
      phase = 'jev-records'
      await page.locator('#jev-records-tab').click()
      const records = page.locator('#jev-records-panel')
      await records.waitFor({ state: 'visible' })
      await records.getByRole('button', { name: /^(Details|详情)$/ }).first().waitFor({ state: 'visible' })
      assert.equal(await records.getByRole('alert').count(), 0, 'Jev records must load without an error notice')
      result.recordsVisible = true
      phase = 'fixture-session-navigation'
      const classifiedTurn = stageSnapshot.turns.find(turn => turn.steps.some(step => step.analysis.status === 'succeeded'))
      assert(classifiedTurn, 'The Host fixture must supply a classified native turn')
      const classifiedSteps = classifiedTurn.steps.filter(step => step.analysis.status === 'succeeded')
      const workspace = page.locator('[data-row-key^="workspace:"]').filter({ hasText: 'Jev compatibility fixture' })
      await workspace.waitFor({ state: 'visible' })
      if (await workspace.getAttribute('aria-expanded') !== 'true') await workspace.click()
      await page.locator(`[data-row-key="session:${stageSnapshot.sessionId}"]`).click()
      const conversation = page.locator('[data-conversation-content]')
      await conversation.waitFor({ state: 'visible' })
      const displayedSession = await conversation.getAttribute('data-conversation-session')
      if (displayedSession !== null) assert.equal(displayedSession, stageSnapshot.sessionId, 'Conversation must show the fixture Session')
      phase = 'jev-stage-navigation'
      const stageName = /^(Stage navigation|阶段导航)$/
      const stageTab = page.getByRole('tab', { name: stageName })
      if (await stageTab.isVisible()) await stageTab.click()
      else {
        await page.getByRole('button', { name: /^(More conversation views|更多会话视图)$/ }).click()
        await page.getByRole('menuitem', { name: stageName }).click()
      }
      const stage = page.getByRole('region', { name: stageName })
      await stage.waitFor({ state: 'visible' })
      const turns = stage.getByRole('navigation', { name: /^(Turns and stages|轮次与阶段)$/ })
      await turns.getByRole('button', { name: new RegExp('^(Turn|第) ' + classifiedTurn.turn + ' ·') }).click()
      for (const step of classifiedSteps) {
        await stage.locator(`[data-step-id="${step.id}"]`).getByText(/^(Classification status: Classified|分类状态: 已分类)$/).waitFor({ state: 'visible' })
      }
      assert.equal(await stage.getByRole('alert').count(), 0, 'Stage navigation must load without an error notice')
      result.stageNavigation = { sessionId: stageSnapshot.sessionId, turn: classifiedTurn.turn, classifiedStepIds: classifiedSteps.map(step => step.id) }
      phase = 'return-to-chat'
      await page.getByRole('tab', { name: /^(Chat|对话)$/ }).click()
      await stage.waitFor({ state: 'hidden' })
      await conversation.getByText('Deterministic fixture completed with recorded native results.', { exact: true }).last().waitFor({ state: 'visible' })
      result.returnedToChat = true
      phase = 'complete'
    }
    await Promise.race([verify(), browserFailure])
    assert.equal(result.pageErrors.length + result.consoleErrors.length + result.importErrors.length, 0, 'Client must load without browser errors')
    result.ok = true
  } catch (error) {
    result.phase = phase
    result.failure = { code: error.code ?? (error.name === 'TimeoutError' ? 'BROWSER_TIMEOUT' : 'BROWSER_CHECK_FAILED'), name: error.name, message: redactWebSecrets(error.message) }
    if (page) {
      try {
        result.visibleDialogs = (await page.getByRole('dialog').allTextContents()).map(text => redactWebSecrets(text).slice(0, 500))
      } catch (observationError) {
        result.dialogObservationError = redactWebSecrets(observationError.message)
      }
    }
  } finally {
    clearTimeout(timer)
    if (page) {
      page.off('pageerror', onPageError)
      page.off('console', onConsole)
      page.off('requestfailed', onRequestFailed)
      page.off('response', onResponse)
    }
    for (const resource of [context, browser]) {
      try { await resource?.close() } catch (error) {
        result.ok = false
        const failure = { code: 'BROWSER_CLEANUP_FAILED', name: error.name, message: redactWebSecrets(error.message) }
        if (!result.failure) { result.phase = 'browser-cleanup'; result.failure = failure }
        else (result.cleanupErrors ??= []).push(failure)
      }
    }
  }
  return result
}
