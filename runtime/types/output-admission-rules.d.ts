/** Conservative, byte-preserving candidates from command and test logs. */
export interface LogSpan {
    start: number;
    end: number;
    firstLine: number;
    lastLine: number;
    reason: 'progress' | 'repeated-warning' | 'routine-pass' | 'repeated-failure';
    originalFirstLine?: number;
}
/** Count the length used by admission budgets without splitting surrogate pairs. */
export declare function codePoints(text: string): number;
/** Return interior noise spans, or undefined when their count exceeds maxBlocks. */
export declare function generalCandidates(text: string, targetChars: number, maxBlocks: number): LogSpan[] | undefined;
export type TestRunner = 'vitest-jest' | 'pytest' | 'tap';
/** Identify only common text protocols with unambiguous pass/fail markers. */
export declare function testRunner(text: string): TestRunner | undefined;
/** Protect failure details and summaries; duplicate only exact, long failure bodies. */
export declare function testCandidates(text: string, runner: TestRunner, slowMs: number, duplicateLines: number, duplicateChars: number): {
    semantic: LogSpan[];
    rules: LogSpan[];
};
/** Amortize one omission marker across adjacent, same-kind test lines. */
export declare function groupCandidates(text: string, spans: readonly LogSpan[], maxChars: number): LogSpan[];
/** Replace disjoint original slices; every retained slice keeps its exact code units. */
export declare function replaceSpans(text: string, replacements: readonly {
    span: LogSpan;
    marker: string;
}[]): string;
//# sourceMappingURL=output-admission-rules.d.ts.map