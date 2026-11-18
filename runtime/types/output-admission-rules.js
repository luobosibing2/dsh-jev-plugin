/** Conservative, byte-preserving candidates from command and test logs. */
const visible = (text) => text.replace(/\x1b\[[0-9;]*m/g, '');
function linesOf(text) {
    const lines = [];
    let start = 0;
    for (let index = 0; index < text.length; index++) {
        if (text[index] !== '\n')
            continue;
        lines.push({ text: text.slice(start, index + 1), start, end: index + 1, number: lines.length + 1 });
        start = index + 1;
    }
    if (start < text.length)
        lines.push({ text: text.slice(start), start, end: text.length, number: lines.length + 1 });
    return lines;
}
/** Count the length used by admission budgets without splitting surrogate pairs. */
export function codePoints(text) { return Array.from(text).length; }
const PROTECTED = /(?:\b(?:error|failed|failure|exception|traceback|assert(?:ion)?|fatal|panic|timeout|timed out|stopped|killed|sandbox|denied|truncated|spill|full output|exit code|job status|session exited|summary|total|duration|skipped|todo)\b|^\s*at\s+\S+|^\s*File\s+"|^\s*#\s*\d+\s+(?:not ok|fail))/i;
const SUMMARY = /^\s*(?:\d+\s+(?:passed|failed|skipped|tests?)\b|(?:tests?|test suites?|test files|snapshots|duration|time)\s*:)/i;
const PROGRESS = /^\s*(?:\d{1,3}%|(?:progress|downloading|installing|building|compiling|collecting|loading|running|waiting)\s*[:#-]?\s*\d+(?:\.\d+)?%?(?:\s*[/:=-]\s*[\d.%█▓▒░#=> -]*)?)\s*$/i;
const ROUTINE_PASS = /(?:^\s*(?:✓|✔|PASS\b|ok\s+\d+\b|test\s+.+\.\.\.\s+ok\b)|^\s*\d+\s+passed\b)/i;
const WARNING = /^\s*(?:\[(?:warn|warning)\]|(?:warn|warning|deprecated)(?:\s*[:：-]|\s+))/i;
function noiseReason(line, seenWarnings) {
    const body = visible(line).trim();
    if (PROTECTED.test(body) || SUMMARY.test(body))
        return undefined;
    if (WARNING.test(body)) {
        if (!seenWarnings.has(body)) {
            seenWarnings.add(body);
            return undefined;
        }
        return 'repeated-warning';
    }
    if (PROGRESS.test(body))
        return 'progress';
    if (ROUTINE_PASS.test(body))
        return 'routine-pass';
    return undefined;
}
/** Return interior noise spans, or undefined when their count exceeds maxBlocks. */
export function generalCandidates(text, targetChars, maxBlocks) {
    const rows = linesOf(text);
    if (!rows.length)
        return [];
    const seen = new Set();
    const blocks = [];
    let group = [];
    let reason;
    const flush = () => { if (group.length)
        blocks.push({ rows: group, reason }); group = []; reason = undefined; };
    for (const row of rows) {
        const next = noiseReason(row.text, seen);
        if (codePoints(row.text) > targetChars) {
            flush();
            blocks.push({ rows: [row] });
            continue;
        }
        const chars = group.reduce((total, item) => total + codePoints(item.text), 0);
        if (group.length && (next !== reason || chars + codePoints(row.text) > targetChars))
            flush();
        group.push(row);
        reason = next;
    }
    flush();
    const candidates = blocks.slice(1, -1).flatMap(block => block.reason === undefined ? [] : [{
            start: block.rows[0].start, end: block.rows.at(-1).end,
            firstLine: block.rows[0].number, lastLine: block.rows.at(-1).number, reason: block.reason,
        }]);
    return candidates.length > maxBlocks ? undefined : candidates;
}
/** Identify only common text protocols with unambiguous pass/fail markers. */
export function testRunner(text) {
    const plain = visible(text);
    if (/(?:^|\n)(?:\s*(?:PASS|FAIL)\s+\S+\.(?:test|spec)\.[cm]?[jt]sx?|\s*Test Files\s+\d+|\s*Tests\s+\d+)/m.test(plain))
        return 'vitest-jest';
    if (/(?:^|\n)(?:=+\s*test session starts\s*=+|=+\s*FAILURES\s*=+|\S+::\S+\s+(?:PASSED|FAILED|SKIPPED)|=+\s*\d+\s+(?:passed|failed))/m.test(plain))
        return 'pytest';
    if (/(?:^|\n)TAP version \d+\s*(?:\n|$)/m.test(plain))
        return 'tap';
    return undefined;
}
function testBoundary(line, runner) {
    line = visible(line);
    if (runner === 'vitest-jest')
        return /^FAIL\s+\S+\.(?:test|spec)\.[cm]?[jt]sx?\b|^\s{0,2}(?:Test Files|Tests|Snapshots|Time|Duration)\s+\d/i.test(line);
    if (runner === 'pytest')
        return /^(?:=+\s*(?:short test summary|FAILURES|\d+\s+(?:passed|failed))|\S+::\S+\s+(?:PASSED|FAILED|SKIPPED)|_+\s*\S+\s*_+\s*$)/.test(line);
    return /^(?:ok\s+\d+|not ok\s+\d+|#\s*(?:tests?|pass|fail|skip|todo)\b|\d+\.\.\d+)/.test(line);
}
function failureHeader(line, runner) {
    line = visible(line);
    if (runner === 'vitest-jest')
        return /^\s*(?:FAIL\s+\S+|[×✕]\s+\S+)/.test(line);
    if (runner === 'pytest')
        return /^_+\s*\S+\s*_+\s*$|^\S+::\S+\s+FAILED/.test(line);
    return /^\s*not ok\s+\d+\b/.test(line);
}
function passing(line, runner) {
    line = visible(line);
    if (runner === 'vitest-jest')
        return /^\s*(?:✓|✔|PASS\s+\S+)/.test(line);
    if (runner === 'pytest')
        return /^\S+::\S+\s+PASSED\b/.test(line);
    return /^\s*ok\s+\d+\b/.test(line);
}
function durationMs(line) {
    const match = visible(line).match(/(?:\(|\s)(\d+(?:\.\d+)?)\s*(ms|s)\b/i);
    return match === null ? undefined : Number(match[1]) * (match[2].toLowerCase() === 's' ? 1000 : 1);
}
/** Protect failure details and summaries; duplicate only exact, long failure bodies. */
export function testCandidates(text, runner, slowMs, duplicateLines, duplicateChars) {
    const rows = linesOf(text);
    const semantic = [];
    const rules = [];
    const seenWarnings = new Set();
    const seenDetails = new Map();
    for (let index = 0; index < rows.length; index++) {
        const row = rows[index];
        if (failureHeader(row.text, runner)) {
            let end = index + 1;
            while (end < rows.length && !testBoundary(rows[end].text, runner))
                end++;
            const detail = rows.slice(index + 1, end).map(item => item.text).join('');
            if (end - index - 1 >= duplicateLines && codePoints(detail) >= duplicateChars) {
                const firstLine = seenDetails.get(detail);
                if (firstLine === undefined)
                    seenDetails.set(detail, rows[index + 1].number);
                else
                    rules.push({ start: rows[index + 1].start, end: rows[end - 1].end,
                        firstLine: rows[index + 1].number, lastLine: rows[end - 1].number,
                        originalFirstLine: firstLine, reason: 'repeated-failure' });
            }
            index = end - 1;
            continue;
        }
        if (PROTECTED.test(visible(row.text)) || SUMMARY.test(visible(row.text)))
            continue;
        const duration = durationMs(row.text);
        if (duration !== undefined && duration >= slowMs)
            continue;
        const reason = noiseReason(row.text, seenWarnings);
        if (passing(row.text, runner) || reason === 'progress') {
            if (/(?:skip|todo|warning|warn|fail|error)/i.test(row.text))
                continue;
            semantic.push({ start: row.start, end: row.end, firstLine: row.number, lastLine: row.number,
                reason: passing(row.text, runner) ? 'routine-pass' : 'progress' });
        }
        else if (reason === 'repeated-warning') {
            semantic.push({ start: row.start, end: row.end, firstLine: row.number, lastLine: row.number, reason });
        }
    }
    return { semantic, rules };
}
/** Amortize one omission marker across adjacent, same-kind test lines. */
export function groupCandidates(text, spans, maxChars) {
    const result = [];
    for (const span of spans) {
        const previous = result.at(-1);
        if (previous !== undefined && previous.end === span.start && previous.reason === span.reason
            && codePoints(text.slice(previous.start, span.end)) <= maxChars) {
            previous.end = span.end;
            previous.lastLine = span.lastLine;
        }
        else
            result.push({ ...span });
    }
    return result;
}
/** Replace disjoint original slices; every retained slice keeps its exact code units. */
export function replaceSpans(text, replacements) {
    let position = 0;
    let output = '';
    for (const { span, marker } of [...replacements].sort((a, b) => a.span.start - b.span.start)) {
        if (span.start < position)
            throw new Error('Overlapping admission spans');
        output += text.slice(position, span.start) + marker;
        position = span.end;
    }
    return output + text.slice(position);
}
//# sourceMappingURL=output-admission-rules.js.map