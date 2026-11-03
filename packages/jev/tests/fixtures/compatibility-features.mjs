/** Published-release checks exclude routing that requires the paired source Host. */
import assert from 'node:assert/strict'

export const publishedFeatures = Object.freeze(Object.fromEntries([
  'skill-selection', 'file-ranking', 'instruction-guidance', 'completion-check',
  'drift-monitoring', 'goal-supervision', 'interjection-routing', 'shared-findings',
  'output-admission', 'test-log-admission', 'workspace-approval', 'stage-navigation',
].map(id => [id, id !== 'interjection-routing'])))

/**
 * Verify the actual published-profile switches and describe its capability exclusion.
 * @param features - Registered features read from the installed Jev service.
 * @returns Enabled feature identities and the explicitly untested routing capability.
 */
export function verifyPublishedFeatureCoverage(features) {
  assert.equal(features.find(feature => feature.id === 'interjection-routing')?.enabled, false,
    'Published-release checks must disable interjection-routing; enabling it requires Agent.interruptResponse()')
  assert.deepEqual(features.map(({ id, enabled }) => [id, enabled]).sort(),
    Object.entries(publishedFeatures).sort(), 'Published-release fixture features must match the declared checks')
  return {
    enabledFeatureIds: features.filter(feature => feature.enabled).map(feature => feature.id).sort(),
    excludedFeatures: [{ id: 'interjection-routing', enabled: false, verified: false,
      requiredCapability: 'Agent.interruptResponse()',
      reason: 'Response interruption is verified separately with the paired source Host, not these published runtimes.' }],
  }
}
