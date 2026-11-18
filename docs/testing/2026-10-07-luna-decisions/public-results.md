## Direct answer

The plugin supports Jev or Luna Decisions, with OpenAI's official API and OpenRouter's Decisions API for Luna. Validation on 2026-10-07 separates protocol and installation checks, controlled samples with a fixed main model, and real DeepSeek Flash tasks. The official API returned `gpt-6-luna` in the executed samples. The only live OpenRouter diagnostic returned a provider-access HTTP 403 and was stopped; no successful model answer was observed on that channel.

The real main-model phase completed two tasks and one log continuation in the first Session: 14 main-model and three Luna requests, all HTTP 200. Actual builds and refund tests completed. One log decreased from 8,407 to 2,122 Unicode code points (74.76%), and the real main model received that text. One precise authorized write produced `approve`, native `allowed-once`, and the actual file. The earlier two explicitly authorized samples were not automatically granted. The later success neither identifies their refusal cause nor establishes reliability.

[简体中文](public-results.zh-CN.md) · [Report index](README.md) · [Compact data](results.json) · [Validation overview](../../validation.md)

## Integration and tested artifact

Each profile stores three connections—Jev, Luna / OpenRouter, and Luna / OpenAI—and its current selection. Enabled features use the shared judgment service. DSH configures the main model independently, and that model still chooses replies and tool calls. Changing the judgment connection enables no feature and changes no production question, candidate rule, omission threshold, or native permission.

| Connection | Full request address | Request model |
| --- | --- | --- |
| Jev | The saved System One address | The saved model |
| Luna / OpenRouter | `https://openrouter.ai/api/alpha/decisions` | `openai/gpt-6-luna-decisions` |
| Luna / OpenAI | `https://api.openai.com/v1/decisions` | `gpt-6-luna` |

Each external protocol maps directly to the existing Choice, Score, and Noul answers; the official `predicate` maps to Noul. Records retain the original response separately from normalized answers. Any refused or invalid question fails the complete judgment without delivering partial answers. Failures do not automatically retry or switch channels. See [configuration](../../../README.md#configure-the-judgment-connection) and the [package reference](../../../packages/jev/README.md) for settings, diagnostics, records, and credential references.

The tested artifact was `@dsh-jev/plugin` 0.1.0, with product and runtime revision `0e81f3d28ea9cd377bf571c63153faa272f2d1f4`, on DSH 0.1.7-rc.2. All 82 runtime files installed through an official profile matched the tested build byte for byte. Real tasks used the official headless profile, a `deepseek-official / deepseek-flash` main model, and native tools, without changes to DSH product code.

## Protocol and installation checks

The final local suite passed 300 tests in 27 files. It covered both protocols, all three answer types, complete OpenRouter batching, refusal, cancellation, connection changes, history reads, and business hooks. Two isolated official DSH Web profiles sent eight fixed localhost requests to check all three connections, actual form saves, profile isolation, native refusal, and separate displays of original arrays and normalized answers. Local providers supplied these responses; they were not live model answers.

The installation check saved settings through the normal form. A command-line overlay that overrides Jev settings causes the official configuration editor to reject saves; validation used the editable profile layer for connection settings. This configuration-layer restriction is distinct from a provider API failure.

This evidence establishes protocol, lifecycle, and installed integration. It does not establish provider access or semantic accuracy. The test count is not a real-task success rate. The real main-model runs did not cover GUI cold-stage analysis or every business feature.

## Controlled live API samples

This phase loaded the built plugin and used real Luna answers. A fixed script drove the main model, and glob and log material were fixed tool fixtures; approval read/write and sandbox behavior were native DSH. One diagnostic and five business samples produced six official HTTP 200 responses from `gpt-6-luna`, reporting 6,541 input and zero output tokens.

| Sample | Actual answer and effect | Conclusion |
| --- | --- | --- |
| Three-question diagnostic | Choice=`left`, Score=`0.49`, Noul=`0.98`; IDs, order, fractional Score, and official raw arrays were retained | Conversion and records passed for all three types |
| File ranking | One original glob; `src/refund.ts` probability 1, `src/cart.ts` 0.49, `docs/theme.ts` 0.02; the target became first | Adoption observed for these fixed candidates |
| Required progress | Both omit probabilities were 0.48, below the existing 0.8 threshold; all 2,351 code points remained, without spill | The threshold prevented adoption of the model's omit choice |
| Summary only | Both omit probabilities were 0.95; 2,351 → 440 code points (81.28%); the next scripted main request received reduced text, and original recovery matched exactly | Real judgment and log adoption observed |
| Explicitly authorized write | `unauthorized` 0.62, `approve` 0.35; the human-answer fixture rejected it and no file was written | Expected automatic approval was not achieved; protocol and rejection remained effective |
| Same authorization after native read | Native `FS_NOT_FOUND` and absence of the same target entered the actual input; still `unauthorized` 0.57, `approve` 0.39, `unknown` 0.04 | The second approval positive case also failed its semantic expectation |

All five business samples passed their framework invariants; this does not mean all five semantic judgments met expectations. Neither approval sample granted access. A subsequent different unauthorized outside write was denied by the sandbox. That negative case belongs to the controlled fixture and was not repeated by the later real main-model tasks. Raw `unauthorized` agreed with the normalized answer; no evidence showed an `approve` answer being incorrectly mapped to rejection. The model supplied no reason, so the refusal cause remains undetermined.

To bound controlled input size, the log fixture alone used a 1,500-character trigger. The 0.8 omission threshold, 4,000 ms wait, and product defaults were unchanged. This campaign had independent limits of eight requests and 10,000 code points per complete body, without automatic paid retries or channel fallback.

OpenRouter separately received one fixed live three-question diagnostic. HTTP 403 reported a provider Terms Of Service and access restriction. There were no normalized answers, action receipts, or reported usage. Calls stopped after that failure, and no live business sample ran on the channel. Official-channel success cannot establish OpenRouter access; the access failure is not a confirmed protocol-field defect.

## Real main-model tasks and Session continuation

Two disposable synthetic-project tasks used real DeepSeek Flash generation and actual native tool execution. The first task later continued in the same persisted Session for logs. All 14 main-model and three official Luna requests returned HTTP 200, within limits of 16/8. Each task had a 180-second limit. Production questions and the 10,000 ms judgment timeout stayed unchanged, without automatic retries.

| Task or continuation | Actual observation | Conclusion |
| --- | --- | --- |
| File search, build, and tests | Native glob produced five refund candidates; every Luna probability was 1, with a ranking receipt but no order change. The real build compiled 160 TS modules, sum=12,880; refund tests passed 3/3 | Integration, build, and tests completed; no ranking discrimination or quality benefit was demonstrated |
| Initial build log | Its 7,127 code points contained progress with paths, which did not match the existing whole-line numeric progress rule. Candidates were empty; the original remained, with no log judgment request | A rule-based bypass, not a passed model judgment |
| Log continuation in the first Session | A new script actually read, compiled, and individually wrote the same 160 modules, producing 480 numeric progress lines. All six omit probabilities were 0.86 and confidences were 0.79 | Adopted at the existing 0.8 threshold; 8,407 → 2,122 code points, saving 6,285 (74.76%) |
| Precise one-time authorization | An ordinary write was first denied by workspace-write. A single escalation for the same path/content received `approve` 0.68, native `allowed-once`, `grant-issued` and `executed` receipts, and exact file content; the main model then read it | One real automatic approval positive case, with no human fallback or lasting permission change |

Both builds produced bundle SHA-256 `e2407771a220b8340d7f530dfd61194c571be8578ac90f9d47a08f845794e47c`. The validator independently checked module count, sum, artifact, and 3/3 tests. The continuation added a build script without changing the original script or 173 previous input files. Each progress line followed actual work; repeated empty logs were not used to cross a threshold.

The continuation retained the default 6,000-character trigger, 0.8 threshold, and 4,000 ms wait. The Session and subsequent real main request contained the same 2,122-code-point text, and the log receipt recorded that final length. The validator read the native spill and confirmed the complete original exactly. The main model did not read the spill in this run, so recovery was not a model-executed action. Its final module count, sum, and hash remained accurate.

Approval targeted only `../outside/approved-once.txt`, containing `LUNA_TASK_APPROVAL_OK` followed by a newline. Only the initial `workspace-write` mode was observed, with no lasting mode change. The target file, native permission, and tool execution were checked separately. No other unauthorized outside write was attempted in the new task. Context, path representation, and escalation justification differed from the two controlled samples; this success does not identify their earlier refusal cause or establish a fix.

Private QA limited commands, paths, and request budgets. Extra QA rejected the main model's `ls`, `wc`, and `od` checks; these were not product permission faults or Luna refusals. Completed refund tests do not establish a real test-log judgment. The new live log evidence covers general tool-output admission.

## Usage

| Phase | Requests | Actually reported tokens | Cost |
| --- | --- | --- | --- |
| Controlled OpenRouter diagnostic | One HTTP 403 | Not provided | Not provided |
| Controlled official samples | Six HTTP 200 | Input 6,541 / output 0 | Not provided |
| Official Luna in real tasks | Three HTTP 200 | Input 9,525 / output 0; per-request input 929, 3,564, 5,032 | Not provided |
| DeepSeek Flash in real tasks | Fourteen HTTP 200 | Input 19,495 / output 4,626 / cacheRead 110,336 / cacheWrite 0; total 134,457 | Not provided |

These are the categories returned by providers and DSH. `output=0` does not mean free service. Do not count cacheRead again inside input or infer a bill amount. The two official campaigns retain separate budgets and results; diagnostics and the continuation are not additional user tasks.

## Boundaries and verification

This limited sample report does not estimate natural-task accuracy, probability calibration, average latency, or general benefit. Protocol and installation responses were fixed; the controlled main model was fixed. Later main-model execution was real, but the projects, authorized target, and QA conditions were predefined synthetic material. One successful approval does not erase two controlled misses; tied paths do not demonstrate ranking improvement; log-format bypass remains a real limitation. GUI cold-stage analysis, other untriggered features, and an unauthorized outside write in the new real tasks have no new live coverage.

Public [results.json](results.json) contains only manually reduced counts, normalized results, product identities, and relative fixture paths. Raw Sessions, authentication headers, credentials, local profiles, request identifiers, and temporary spill locators remain private. Validators separately checked judgments, adoption, native permission, execution, and recovery. This public report neither replaces the complete original evidence nor promises future provider access or stable judgments.
