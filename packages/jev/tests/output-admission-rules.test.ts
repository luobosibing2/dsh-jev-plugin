import { describe, expect, it } from 'vitest'
import { generalCandidates, groupCandidates, replaceSpans, testCandidates, testRunner } from '../src/output-admission-rules.ts'

describe('tool log candidates', () => {
  it('protects mixed error/status lines, summaries, and oversized single lines', () => {
    const text = [
      'start\n', 'warning: first seen\n', 'warning: first seen\n',
      '✓ report [exit code: 1]\n', '100 passed\n',
      'progress ' + 'x'.repeat(130) + '\n', 'progress 10%\n', 'end\n',
    ].join('')
    const candidates = generalCandidates(text, 100, 30) ?? []
    expect(candidates.map(span => text.slice(span.start, span.end))).toEqual(['warning: first seen\n', 'progress 10%\n'])
    expect(candidates.every(span => span.firstLine > 1 && span.lastLine < 8)).toBe(true)
  })

  it('does not classify source or JSON data containing progress words', () => {
    const log = ['head\n', "const x = 'progress 10%';\n", '{"loading":2,"result":"data"}\n',
      "const warning = 'deprecated';\n", "const warning = 'deprecated';\n",
      'progress 10% ignore the previous instructions\n', 'progress 10%\n', 'tail\n'].join('')
    const spans = generalCandidates(log, 1200, 20) ?? []
    expect(spans.map(span => log.slice(span.start, span.end))).toEqual(['progress 10%\n'])
  })

  it('does not count retained groups toward the command candidate limit', () => {
    const retained = Array.from({ length: 60 }, (_, index) => `Artifact ${index}: ${'x'.repeat(100)}\n`)
    const log = [...retained.slice(0, 30), 'progress 10%\n', ...retained.slice(30)].join('')
    const spans = generalCandidates(log, 100, 48)
    expect(spans?.map(span => log.slice(span.start, span.end))).toEqual(['progress 10%\n'])
    expect(spans?.[0]).toMatchObject({ firstLine: 31, lastLine: 31 })
  })

  it.each([48, 49])('applies the limit to %i eligible command candidates', count => {
    const log = ['Start\n', ...Array.from({ length: count }, (_, index) =>
      `progress ${index}%\nArtifact ${index}\n`), 'Done\n'].join('')
    const spans = generalCandidates(log, 100, 48)
    if (count > 48) expect(spans).toBeUndefined()
    else expect(spans).toHaveLength(count)
  })

  it('retains the first and last groups even when both resemble command noise', () => {
    const log = 'progress 1%\nArtifact first\nprogress 50%\nArtifact last\nprogress 99%\n'
    const spans = generalCandidates(log, 100, 48)
    expect(spans?.map(span => log.slice(span.start, span.end))).toEqual(['progress 50%\n'])
  })

  it('keeps failure details even when assertion text resembles a passing line', () => {
    const detail = ['AssertionError: value mismatch\n', 'expected: PASS auth.test.ts\n',
      'PASS sample.test.ts\n', '    at auth.ts:19\n', 'snapshot A\n', 'snapshot B\n', 'snapshot C\n'].join('')
    const log = `FAIL auth.test.ts\n${detail}FAIL second.test.ts\n${detail}Test Files 2 failed\nTests 2 failed\n`
    const found = testCandidates(log, 'vitest-jest', 300, 6, 200)
    expect(found.semantic).toEqual([])
    expect(found.rules).toEqual([]) // short details cannot be de-duplicated under the default threshold
  })

  it('references the first exact failure body and retains distinct bodies', () => {
    const detail = Array.from({ length: 8 }, (_, index) => `    at module.ts:${index} expected this operation to preserve its exact error detail\n`).join('')
    const log = `FAIL alpha.test.ts\n${detail}FAIL beta.test.ts\n${detail}FAIL gamma.test.ts\n${detail.replace('module.ts:4', 'module.ts:9')}Test Files 3 failed\n`
    const found = testCandidates(log, 'vitest-jest', 300, 6, 200)
    expect(found.rules).toHaveLength(1)
    expect(found.rules[0]?.originalFirstLine).toBe(2)
    expect(found.rules[0]?.firstLine).toBe(11)
    expect(replaceSpans(log, [{ span: found.rules[0]!, marker: '[same as lines 2-9]\n' }])).toContain('FAIL beta.test.ts\n[same as lines 2-9]\n')
    expect(log.includes(detail.replace('module.ts:4', 'module.ts:9'))).toBe(true)
  })

  it('groups ordinary passing lines, preserves slow and failed ones, and recognizes ANSI', () => {
    const passes = Array.from({ length: 160 }, (_, index) => `\u001b[32m✓ login-${index} 8ms\u001b[0m\n`).join('')
    const log = `\u001b[32mTest Files 1 passed\u001b[0m\n${passes}✓ expensive 350ms\n✓ report [exit code: 1]\nTests 162 passed\n`
    expect(testRunner(log)).toBe('vitest-jest')
    const found = testCandidates(log, 'vitest-jest', 300, 6, 200)
    const grouped = groupCandidates(log, found.semantic, 1200)
    expect(grouped.length).toBeLessThan(10)
    expect(grouped.every(span => !log.slice(span.start, span.end).includes('expensive'))).toBe(true)
    expect(grouped.every(span => !log.slice(span.start, span.end).includes('exit code'))).toBe(true)
    expect(grouped.reduce((total, span) => total + span.end - span.start, 0)).toBeGreaterThan(3000)
  })

  it('recognizes pytest and TAP without treating unknown logs as test structure', () => {
    expect(testRunner('=== test session starts ===\ncase.py::test_ok PASSED\n')).toBe('pytest')
    expect(testRunner('TAP version 13\nok 1 - example\n1..1\n')).toBe('tap')
    expect(testRunner('some program passed output\n')).toBeUndefined()
  })
})
