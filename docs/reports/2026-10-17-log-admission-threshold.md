## Direct answer

English | [简体中文](2026-10-17-log-admission-threshold.zh-CN.md)

The default log-admission `omitProbability` is **0.7**, shared by generic and test logs. Explicit profile values still apply: a saved value of `0.8` is not overwritten. Both features remain off by default. The four-second wait and minimum net savings of 300 code points and 10% are unchanged. The [configuration and adoption implementation](../../packages/jev/src/output-admission.ts#L25) uses `probabilities.omit`, falling back to `confidence` only when that field is absent; the answer must also select `omit`.

## Existing project test logs

The 2026-10-17 comparison used unchanged existing tests from Jev commit `22d4166607b3a24cd098279d76bb9a9bcd50a2a9`. Vitest 4.1.8 executed 94 protocol/service tests, 39 stage/session tests, 69 admission/approval tests and 22 selection/forwarding tests: **224 passing tests across 14 files**. No new test template or modified test behavior supplied these logs.

Four actual process logs supplied six exploratory tasks and four validation tasks, followed by two byte-identical request repeats. All 12 external judgments returned `jev-1.13.0`, without automatic retries. The main model was scripted. Native Bash in an isolated official DSH 0.2.1-alpha.3 profile replayed the captured logs through the production Hook. Ten tasks therefore do not represent ten test executions or ten independent projects.

Tasks and rules identifying required complete source lines were fixed before judgment. The main comparison contains **110 candidate observations, six required candidate observations and 22 complete required facts**. Some tasks reuse the same log block; these observations are not independent statistical trials.

| Threshold | Selected candidates | Applied omissions | False omissions / 6 required observations | Required facts lost / 22 | Net code points saved | Net UTF-8 bytes saved |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0.65 | 47 | 47 | 0/6 | 0/22 | 16,419 | 16,681 |
| 0.70 | 47 | 47 | 0/6 | 0/22 | 16,419 | 16,681 |
| 0.80 | 1 | 0 | 0/6 | 0/22 | 0 | 0 |

Savings came from four summary-only tasks. Their candidate omit probabilities ranged from 0.70–0.75, 0.71–0.75, 0.70–0.77 and 0.75–0.81. A threshold of 0.65 added no benefit over 0.70. The single candidate selected at 0.80 failed the net-savings gate, leaving the original intact. All real judgments used the then-current 0.8 profile. Local adoption replays reused the saved real answers to verify lower thresholds, without another model request for each threshold.

Eight adoption replays covered the four summaries at 0.65 and 0.70 through the shipped service, adapter, Hook, spill and Session paths. Net savings include omission markers and a 213-code-point recovery notice. Each final tool result matched its Session and following scripted main-model request, and every original was recovered exactly. The real network log and request-budget file retained identical hashes.

## Configuration effect

Profiles without an explicit threshold use 0.7. Set `omitProbability: 0.8` explicitly to retain the previous adoption threshold. Feature switches, candidate protection, original-log storage, explicit complete-log requests and net-savings checks still determine whether shortened text is delivered; a candidate passing the probability threshold does not by itself cause an omission.

## Limits and verification

All six required candidate observations selected `keep`, with omit probabilities of only 0.12–0.27. None fell within the predefined distance of 0.05 from any target threshold of 0.65, 0.70 or 0.80. This comparison did not distinguish their false-omission risks. The value 0.7 is an adoption parameter that permits more summary-log reduction; it does not mean 70% accuracy or a calibrated safety level.

The four logs come from one real project. This work did not cover cross-project distributions, natural failing or skipped CI logs, natural main-model answers, long-session compaction or net financial benefit. The 12 judgments reported 77,907 input and 5,138 output tokens, with latencies of 500–2,814ms and a median of 559.5ms. Byte savings cannot directly establish cost savings. Raw local process output, judgment records, Sessions and credentials are not included in the repository; this report preserves aggregate observations and does not replace the full original evidence.
