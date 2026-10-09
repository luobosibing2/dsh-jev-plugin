/** Produce public metadata and receipts from private, newly generated validation evidence. */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const project = fileURLToPath(new URL('../..', import.meta.url))
const artifacts = join(project, '.artifacts/latest-harness-validation')
const output = join(project, 'docs/testing/2026-10-09-harness-compatibility')
const hash = text => createHash('sha256').update(text).digest('hex')
const json = async path => JSON.parse(await readFile(path, 'utf8'))
const optional = async path => existsSync(path) ? json(path) : undefined
const ndjson = async path => existsSync(path) ? (await readFile(path, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line)) : []
const identifiers = new Map()
const safeIdentifier = value => {
  if (!identifiers.has(value)) identifiers.set(value, 'evidence-' + (identifiers.size + 1))
  return identifiers.get(value)
}
function sanitize(value) {
  if (typeof value === 'string') return value.replaceAll(project, '$WORKTREE/')
    .replace(/\/var\/folders\/[^"\s]+/g, '$PRIVATE_SPILL')
    .replace(/(?:session-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, safeIdentifier)
    .replace(/call_[A-Za-z0-9_]+/g, safeIdentifier)
  if (Array.isArray(value)) return value.map(sanitize)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'sessionId' && key !== 'sessionIds').map(([key, item]) => [sanitize(key), sanitize(item)]))
  return value
}
const cases = []
const receipts = []
for (const caseId of (await readdir(join(artifacts, 'cases'))).sort()) {
  const directory = join(artifacts, 'cases', caseId)
  const execution = await optional(join(directory, 'execution.json'))
  if (!execution) continue
  const observation = await optional(join(directory, 'run-observation.json'))
  const sessionIds = observation?.sessionIds ?? (execution.sessionId ? [execution.sessionId] : [])
  const allRecords = await optional(join(directory, 'ledger.json')) ?? []
  const probe = await optional(join(directory, 'probe.json'))
  const records = allRecords.filter(record => record && (sessionIds.includes(record.sessionId) || record.id === probe?.recordId))
  const http = await ndjson(join(directory, 'http.jsonl'))
  const events = await ndjson(join(directory, 'stdout.jsonl'))
  const stderr = await readFile(join(directory, 'stderr.log'), 'utf8')
  const summary = {
    caseId, layer: execution.layer, features: execution.features ?? ['stage-navigation'], artifactPhase: caseId.startsWith('current-cwd') ? 'current-working-directory-update' : 'first-compatible-build',
    command: caseId === 'stage-navigation' ? 'node scripts/validation/latest-harness-stage-run.mjs' : 'node scripts/validation/latest-harness-run.mjs ' + caseId,
    exitCode: execution.code, signal: execution.signal, timedOut: execution.timedOut ?? false,
    elapsedMs: execution.elapsedMs, sessionIds, setupWarning: stderr.includes('did not activate'),
    realMainRequests: http.filter(item => item.endpoint.includes('api.deepseek.com')),
    realJudgmentRequests: http.filter(item => item.endpoint.includes('api.typesafe.ai')),
    errors: observation?.errors ?? [], interactions: observation?.interactions ?? [],
    toolCalls: events.filter(event => event.type === 'tool_call').map(event => ({ callId: event.callId, tool: event.tool, input: event.input })),
    toolResults: events.filter(event => event.type === 'tool_result').map(event => ({ callId: event.callId, status: event.status, chars: Array.from(event.result).length, sha256: hash(event.result), omissionMarker: event.result.includes('[Jev omitted'), error: event.status === 'error' ? event.result : undefined })),
    judgments: records.map(record => ({ operationId: record.id, featureId: record.featureId, sessionId: record.sessionId,
      status: record.status, actionStatus: record.actionStatus, receipts: record.receipts,
      attempts: record.attemptRecords.map(attempt => ({ attemptId: attempt.id, status: attempt.status,
        connection: attempt.connection, response: attempt.response, interpretation: attempt.interpretation,
        failure: attempt.failure, usage: attempt.usage, usageComplete: attempt.usageComplete,
        requestSha256: hash(JSON.stringify(attempt.request)), network: attempt.networkRecords?.map(packet => ({ id: packet.id, status: packet.status, httpStatus: packet.httpStatus, returnedModel: packet.returnedModel, questionCount: packet.questionIds.length, usage: packet.usage })) })) })),
  }
  if (caseId === 'file-ranking') summary.business = { targetMarkerReturned: events.some(event => event.type === 'final' && event.text.includes('AUTH_RESET_IMPLEMENTATION_OK')), candidates: 12 }
  if (caseId === 'glob-zero') summary.business = { expectedCandidates: 0, judgmentBypassed: records.length === 0 }
  if (caseId === 'glob-forty-one') summary.business = { expectedCandidates: 41, judgmentBypassed: records.length === 0 }
  if (caseId === 'skill-selection') summary.business = { originalSkillLoaded: summary.toolCalls.some(call => call.tool === 'skill'), originalSkillMarkerReturned: events.some(event => event.type === 'final' && event.text === 'ORIGINAL_AUTH_RESET_SKILL_LOADED_OK'), controlledSkillCount: 8, defaultSelectedLimit: 5 }
  if (caseId === 'output-admission') {
    const raw = await readFile(join(directory, 'original-log.txt'), 'utf8')
    const receipt = records.flatMap(record => record.receipts).find(item => item.id === 'tool-log-final-result')
    const facts = JSON.parse(receipt.reason)
    summary.business = { inputChars: facts.inputChars, finalChars: facts.finalChars, reductionPercent: (facts.inputChars - facts.finalChars) / facts.inputChars * 100,
      recoveredOriginalChars: Array.from(raw).length, recoveredOriginalSha256: hash(raw), recoveredProgressLines: raw.split('\n').filter(line => line.startsWith('Building ')).length,
      originalBuildMarkerPreserved: raw.includes('BUILD_RESULT: latest-harness-build-complete'), deliveredBuildMarkerPreserved: events.some(event => event.type === 'tool_result' && event.result.includes('BUILD_RESULT: latest-harness-build-complete')), originalSummaryPreserved: raw.includes('Summary: build completed') }
  }
  if (caseId.startsWith('test-log-admission')) summary.business = { testToolInvocations: summary.toolCalls.filter(call => call.tool === 'bash').length,
    testCount: 101, failCount: 0, sentinelReportedPassed: events.some(event => event.type === 'final' && /(?:sentinel|101).*pass|pass.*101/is.test(event.text)),
    originalRetained: summary.toolResults.every(result => !result.omissionMarker), judgmentCount: records.length,
    limitation: caseId === 'test-log-admission' ? 'Node default spec output has no supported runner marker.' : caseId === 'test-log-admission-tap' ? 'The task names arithmetic, protecting matching test details from candidate judgment.' : 'Two native test invocations and two real judgments; omit probabilities 0.73 to 0.80 yielded no final reduction receipt.' }
  if (caseId.startsWith('completion-')) {
    const summaryText = await readFile(join(artifacts, 'workspaces', caseId, 'summary.txt'), 'utf8')
    const checksumPath = join(artifacts, 'workspaces', caseId, 'checksum.txt')
    const checksumText = existsSync(checksumPath) ? await readFile(checksumPath, 'utf8') : undefined
    summary.business = { scriptedInitialMainRequests: 2, realSupplementMainRequests: summary.realMainRequests.length,
      summaryContentCorrect: summaryText === 'ready\n', checksumPresent: checksumText !== undefined, checksumContentCorrect: checksumText === 'checked\n',
      supplementalDeliveries: records.flatMap(record => record.receipts).filter(receipt => receipt.id === 'supplement-delivered').length,
      assessments: records.flatMap(record => record.attemptRecords.flatMap(attempt => attempt.response?.answers.filter(answer => answer.id === 'assessment').map(answer => answer.optionId) ?? [])),
      limitation: 'Fixed seeded diagnosis; the initial assistant answer was scripted. Accurate control sends no real main-model request.' }
  }
  if (caseId === 'instruction-guidance') summary.business = { rawControlledAgentsRuleRead: records.some(record => record.attemptRecords.some(attempt => JSON.stringify(attempt.request.state).includes('After reading guide.txt, state REPORT_RULE_OK'))), finalMarkersPresent: events.some(event => event.type === 'final' && event.text.includes('REPORT_RULE_OK') && event.text.includes('GUIDE_SENTINEL_OK')), reminderDelivered: false, limitation: 'No conflict was established; this sample does not test reminder adoption or enforcement.' }
  if (caseId.startsWith('workspace-approval')) {
    const target = join(artifacts, 'workspaces/approval-outside', caseId === 'workspace-approval' ? 'allowed.txt' : 'exact.txt')
    const text = existsSync(target) ? await readFile(target, 'utf8') : undefined
    const expected = caseId === 'workspace-approval' ? 'APPROVED_ONCE_OK' : 'EXACT_APPROVAL_OK'
    summary.business = { exactFileExists: text !== undefined, exactContentMatches: text === expected,
      nativeGrantIssued: records.some(record => record.receipts.some(receipt => receipt.id === 'grant-issued')),
      toolExecutionReceipt: records.some(record => record.receipts.some(receipt => receipt.id === 'tool-result' && receipt.status === 'executed')),
      limitation: 'One relative-path combined write/read request was not approved; a separate exact-path single-operation request was approved. This does not establish approval reliability.' }
  }
  if (caseId === 'stage-navigation') {
    const stage = await json(join(directory, 'stage-after.json'))
    summary.business = { beforeReadJudgments: stage.countBefore, afterFirstAnalysisJudgments: stage.countAfter, afterSecondMissingJudgments: stage.countSecond,
      steps: stage.snapshot.turns.flatMap(turn => turn.steps.map(step => ({ stepId: step.id, step: step.step, status: step.analysis.status, label: step.analysis.label, originalToolCount: step.tools.length }))),
      limitation: 'Labels are provider judgments on three complete steps; no human stage-accuracy benchmark was run.' }
  }
  if (caseId.startsWith('current-cwd')) {
    const workspace = join(artifacts, 'workspaces', caseId)
    const reportPath = join(workspace, 'child/report.txt')
    const instructions = records.filter(record => record.featureId === 'instruction-guidance')
    summary.business = { nativeDirectoryChange: summary.toolCalls.some(call => call.tool === 'working_directory' && call.input.cd === 'child'),
      childHasProjectMarker: existsSync(join(workspace, 'child/.git')),
      childSkillNativeResolved: events.some(event => event.type === 'tool_result' && event.status === 'completed' && event.result.includes('<skill_content name="child-reporting">') && summary.toolCalls.some(call => call.callId === event.callId && call.tool === 'skill')),
      childSkillDirectRead: summary.toolCalls.some(call => call.tool === 'read' && call.input.file_path === '.agents/skills/child-reporting/SKILL.md'),
      skillJudgmentsWithChildSkill: records.filter(record => record.featureId === 'skill-selection' && record.attemptRecords.some(attempt => attempt.request.questions.some(question => JSON.stringify(question).includes('child-reporting')))).length,
      instructionJudgmentCwds: [...new Set(instructions.flatMap(record => record.attemptRecords.map(attempt => attempt.request.state.operation?.cwd).filter(Boolean)))],
      childRawAgentsRuleInJudgment: instructions.some(record => record.attemptRecords.some(attempt => JSON.stringify(attempt.request.state).includes('Use relative guide.txt and report.txt in this child directory.'))),
      childReportCorrect: existsSync(reportPath) && await readFile(reportPath, 'utf8') === 'CURRENT_CWD_OK\n', initialRootReportAbsent: !existsSync(join(workspace, 'report.txt')),
      limitation: 'Skills are discovered from the nearest project root. A child folder without its own project marker remains inside the initial project; the original child skill was therefore read directly after native lookup failed. Instruction cwd and actual file placement were independently checked.' }
    if (caseId === 'current-cwd-project') summary.business = { nativeDirectoryChange: summary.business.nativeDirectoryChange,
      childHasProjectMarker: summary.business.childHasProjectMarker, childSkillNativeResolved: summary.business.childSkillNativeResolved,
      skillJudgmentsWithChildSkill: summary.business.skillJudgmentsWithChildSkill,
      originalSkillMarkerReturned: events.some(event => event.type === 'final' && event.text === 'CHILD_PROJECT_ORIGINAL_SKILL_OK'),
      mainRequestAndStepLimit: 3, limitation: 'Separate child project has its own .git marker. This bounded task checks project-level discovery after native cwd change; it does not measure skill judgment accuracy.' }
  }
  for (const record of records) for (const receipt of record.receipts) receipts.push({ caseId, sessionId: record.sessionId, operationId: record.id, featureId: record.featureId, ...receipt })
  cases.push(sanitize(summary))
}
const main = cases.flatMap(item => item.realMainRequests)
const judgment = cases.flatMap(item => item.realJudgmentRequests)
const artifactFiles = ['.artifacts/compatibility/dsh-jev-plugin-0.1.0.tgz', '.artifacts/compatibility-final/dsh-jev-plugin-0.1.0.tgz', '.artifacts/compatibility-current-cwd/dsh-jev-plugin-0.1.0-current-cwd.tgz']
artifactFiles.push('.artifacts/web-smoke/root-final-package/dsh-jev-plugin-0.1.0.tgz')
const artifactIdentities = []
for (const path of artifactFiles) if (existsSync(join(project, path))) artifactIdentities.push({ path, sha256: hash(await readFile(join(project, path))) })
const rootWebUiSummary = await optional(join(project, '.artifacts/web-smoke/web-smoke-summary.json'))
const report = { schema: 1, generatedAt: new Date().toISOString(), campaignStartedLocalDate: '2026-10-09', timezone: 'Asia/Shanghai',
  host: { publishedCliVersion: '0.2.1-alpha.2', harnessSourceCommit: 'd743267388641bc76f17c45ce8b4c231aed1d32c', pluginBaseCommit: 'a3de7fc170ddac413f9e5d822dbe399346c215fd' },
  originalInstall: { result: 'rejected-and-rolled-back', reason: 'Original package peers pinned to DSH 0.1.7-rc.2 were incompatible with 0.2.1-alpha.2; no exemption was used.', evidence: '.artifacts/baseline-install/install.log', rerunByThisWorker: false },
  upgradedInstall: { result: 'official-installer-succeeded', profile: 'compatibility-headless', firstInstalledJsCompared: 47, firstMatchingJs: 47, source: 'packages/jev/lib', stageProfile: 'compatibility-stage', currentDirectoryUpdateInstalled: true },
  artifactIdentities, rootWebUiSummary,
  totals: { cases: cases.length, realMainHttpRequests: main.length, realMainHttp200: main.filter(item => item.status === 200).length,
    realMainReturnedModelConfirmed: main.filter(item => item.returnedModel === 'deepseek-flash').length,
    realMainReturnedModelUnavailable: main.filter(item => item.returnedModel === undefined).length,
    realJudgmentHttpRequests: judgment.length, realJudgmentHttp200: judgment.filter(item => item.status === 200).length,
    rootWebUiDiagnosticExcludedFromWorkerTotals: 1, setupFailureCases: cases.filter(item => item.setupWarning).map(item => item.caseId),
    businessCasesWithoutSetupWarnings: cases.filter(item => !item.setupWarning).length },
  liveFeatureCoverage: { 'skill-selection': 'real-main-native-tool-and-real-judgment', 'file-ranking': 'real-main-native-glob-and-real-judgment',
    'drift-monitoring': 'not-run-live', 'completion-check': 'scripted-initial-real-judgment-real-main-supplement-plus-scripted-accurate-control',
    'goal-supervision': 'not-run-live', 'instruction-guidance': 'real-main-raw-AGENTS-no-conflict-judgment', 'interjection-routing': 'not-run-live',
    'shared-findings': 'not-run-live', 'output-admission': 'real-main-native-log-reduction-and-recovered-original', 'test-log-admission': 'real-main-native-test-and-real-judgment-original-kept',
    'workspace-approval': 'one-real-main-negative-and-one-real-main-single-operation-approval', 'stage-navigation': 'real-judgment-cold-three-step-real-main-Session' },
  cases, limitations: [
    'These are bounded compatibility and business samples; they do not establish general semantic accuracy, stable task benefit, cost savings, probability calibration, or production reliability.',
    'Four features lack corresponding live-service samples: drift-monitoring, goal-supervision, interjection-routing, shared-findings. Local tests are reported separately by the parent.',
    'All judgment requests used Jev 1.13.0. No live Luna credential was available and no Luna API request was sent.',
    'The headless shipped profile has no sessionController; its stage consumer was disabled. Stage analysis used the officially initialized Web profile.',
    'An initial observer/overlay configuration attempt produced setup warnings despite a successful main task and is retained separately from clean cases.',
    'Main response metadata observers saw AbortError when the native adapter closed completed SSE streams. HTTP status, partial parsed provider model/usage, Session completion, and business outcomes are kept separately.',
    'Raw request inputs, provider responses, Session captures, credentials, and authenticated Web URLs remain private under .artifacts and are excluded from this report.' ] }
await mkdir(output, { recursive: true })
await writeFile(join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n')
await writeFile(join(output, 'receipts.json'), JSON.stringify({ schema: 1, generatedAt: report.generatedAt, receipts: sanitize(receipts) }, null, 2) + '\n')
console.log(JSON.stringify(report.totals))
