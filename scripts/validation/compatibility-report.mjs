/** Reduce private compatibility runs to bounded, keyless verification facts. */
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: { matrix: { type: 'string' }, output: { type: 'string' } } })
if (!values.matrix || !values.output) throw new Error('Pass --matrix <results.json> and --output <summary.json>')
const matrixPath = resolve(values.matrix)
const matrix = JSON.parse(await readFile(matrixPath, 'utf8'))
const summary = {
  experimentalManifest: matrix.experimentalManifest,
  browserCheckRequested: !!matrix.browserCheckRequested,
  platform: matrix.platform,
  realModelCalls: matrix.realModelCalls,
  versions: matrix.versions.map(item => {
    const fixture = item.fixture
    if (!fixture?.ok || item.failure) throw new Error('A failed compatibility case cannot be summarized as compatible: ' + item.version)
    if (matrix.browserCheckRequested && !item.web?.ok) throw new Error('Missing or failed browser verification for ' + item.version)
    const records = fixture.cases.flatMap(test => test.records)
    const features = [...new Set(records.map(record => record.featureId))].sort().map(featureId => {
      const selected = records.filter(record => record.featureId === featureId)
      return { featureId, succeeded: selected.filter(record => record.status === 'succeeded').length,
        otherStatuses: selected.filter(record => record.status !== 'succeeded').map(record => record.status),
        receipts: [...new Set(selected.flatMap(record => record.receipts.map(receipt => receipt.id + ':' + receipt.status)))].sort() }
    })
    return { version: item.version, officialInstallExitStatus: item.install.code,
      fixturePassed: fixture.ok, activeHostRows: fixture.finalHostRows.filter(row => row.state === 2).length,
      totalHostRows: fixture.finalHostRows.length, sessionDirectoryIsolation: true,
      nativeDirectorySwitch: fixture.cases.some(test => test.label === 'native-cwd-switch'),
      protocolDiagnosticPassed: fixture.diagnostic.ok, logOmissionsAdopted: fixture.logOmissionsAdopted,
      hostExportsResolved: fixture.hostExports?.length,
      instructionAdoption: fixture.cases.map(test => ({
        case: test.label,
        sessionMessageCount: test.messages.filter(message => message.source.kind === 'jev-instruction-guidance').length,
        uniqueModelInputMessageCount: new Set(fixture.modelRequests.filter(request => request.sessionId === test.sessionId)
          .flatMap(request => request.messages.filter(message => message.source.kind === 'jev-instruction-guidance').map(message => message.id))).size,
        notAdoptedReasons: [...new Set(test.records.filter(record => record.featureId === 'instruction-guidance')
          .flatMap(record => record.receipts.filter(receipt => receipt.status === 'not-adopted').map(receipt => receipt.reason)))],
      })),
      nativeApprovalFileVerified: fixture.approvalFile === 'COMPAT_APPROVAL_OK',
      stage: fixture.stage.snapshot.batch, agentErrors: fixture.errors,
      unexpectedHumanQuestions: fixture.unexpectedQuestions, features,
      browser: item.web,
      localJudgmentHttpPackets: item.httpPacketCount, mainModelRequests: fixture.modelRequests.length,
      hostStoppedByExperiment: item.host.stoppedByMatrix ?? item.host.naturalExit === null,
      hostFinalExit: item.host.finalExit, fixtureTimedOut: item.host.fixtureTimedOut,
      evidence: { installLog: item.install.log, hostLog: item.host.log,
        fixture: join(item.caseRoot, 'fixture-result.json'), httpPackets: join(item.caseRoot, 'http-packets.json') } }
  }),
  limits: [
    'Deterministic local model and Jev responses verify integration and adoption, not judgment accuracy or natural-task benefit.',
    'This matrix ran on ' + matrix.platform + '; other operating systems, Desktop carrier and Hub were not tested.',
    'All twelve features were enabled in disposable profiles; production feature defaults were not changed.',
    'Drift used an interval of one and supervision used a larger evidence budget to avoid deliberately truncating fixture logs.',
    'Goal smoke covers the native completion gate; repeated no-progress pauses and every failure/retry lifecycle remain outside this matrix.',
    'Shared-finding smoke covers two native child reports and a support relation, not every correction recipient or cold-resume path.',
    matrix.browserCheckRequested
      ? 'Headless Chromium checked the authenticated official Web profile, installed Jev page and fixture settings in each listed version.'
      : 'This run did not include browser verification.',
  ],
}
await writeFile(resolve(values.output), JSON.stringify(summary, null, 2) + '\n')
console.log(JSON.stringify({ output: resolve(values.output), versions: summary.versions.map(item => ({ version: item.version, passed: item.fixturePassed, active: item.activeHostRows, packets: item.localJudgmentHttpPackets })) }))
