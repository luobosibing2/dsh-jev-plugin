import { expect, it } from 'vitest'
import { publishedFeatures, verifyPublishedFeatureCoverage } from '../../packages/jev/tests/fixtures/compatibility-features.mjs'

const features = () => Object.entries(publishedFeatures).map(([id, enabled]) => ({ id, enabled }))

it('records eleven enabled published-release checks and the unverified interruption capability', () => {
  const coverage = verifyPublishedFeatureCoverage(features())
  expect(coverage.enabledFeatureIds).toHaveLength(11)
  expect(coverage.enabledFeatureIds).not.toContain('interjection-routing')
  expect(coverage.excludedFeatures).toEqual([expect.objectContaining({
    id: 'interjection-routing', enabled: false, verified: false, requiredCapability: 'Agent.interruptResponse()',
  })])
})

it('rejects a published-release fixture that enables routing or skips another declared check', () => {
  const enabled = features().map(feature => ({ ...feature, enabled: true }))
  expect(() => verifyPublishedFeatureCoverage(enabled)).toThrow('enabling it requires Agent.interruptResponse()')
  const disabled = features().map(feature => ({ ...feature, enabled: false }))
  expect(() => verifyPublishedFeatureCoverage(disabled)).toThrow('must match the declared checks')
})
