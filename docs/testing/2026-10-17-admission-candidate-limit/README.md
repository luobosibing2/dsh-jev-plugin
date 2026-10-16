## 直接答案

English | [简体中文](README.zh-CN.md)

The eligible-candidate counting fix passed formal package installation, Host/Web smoke checks on official DSH **0.2.1-alpha.3**, and one real DeepSeek Flash + Jev build-verification task on macOS. The task produced **51 log groups with 24 eligible candidates**. The actual Jev request contained all 24 candidates and 25 complete retained evidence chunks; the persisted Session result preserved every protected chunk. The [sanitized results](results.json) contain the environment, commands, package identity and observations.

Jev selected `omit` for all 24 questions, with omit probabilities **0.58–0.67**. The existing **0.8** threshold rejected every omission, so the original **10,111-code-point** result was delivered unchanged. This verifies judgment eligibility and conservative retention; it does not demonstrate log reduction.

## Package and fixed checks

The plugin was built from base commit `76b3a868ad7257e7f350b6a1079786d1b74ab531` with the local candidate-count fix, regressions and regenerated runtime. Both official profiles installed the same formal root tarball, SHA-256 `1487d2712bfb06fe4cf78729bc49738aff8135df5acb96e284f217e990b52862`. All 86 declared/runtime files matched the source package; all 85 runtime/patch files checked in the real-task installation matched that package.

| Check | Observed result |
| --- | --- |
| Four output-admission test files | 46 tests passed, including retained groups, 48/49 candidates and first/last protection |
| Typecheck and build | Passed; tracked runtime regenerated |
| Built `runtime/output-admission.js` Hook smoke | 3 tests passed, covering candidate counting and both request-budget paths |
| Built-artifact 48/49 probe | 48 candidates returned; 49 returned `undefined` |
| Official package smoke | Install exit 0; 9 Host components running; Web settings and decision records loaded |
| Chromium 156.0.8078.4 | No page, console or script-import errors |

Formal smoke used `pnpm run test:compatibility --version 0.2.1-alpha.3` with a fresh artifact directory. It used deterministic local model replies and made zero real model calls. Node was `v24.14.1`; pnpm was `11.7.0`.

## Real task and evidence

A fresh headless profile installed the same tarball. Only generic output admission was enabled, with its existing defaults, including 48 candidates and a 48,000-code-point serialized request budget. The actual model received a request to use native `bash` once for `node build.mjs`, then report the build marker, aggregate and exit status. The controlled script imported and checked 24 ESM modules, wrote 24 copies and their checksums, and emitted the alternating artifact/progress groups.

The task completed in **4,601 ms** with exit 0: **2 DeepSeek Flash requests**, **1 Jev 1.13.0 request**, and one native Bash invocation. All three requests received HTTP 200. Independent checks confirmed all 24 output checksums and aggregate **300**. The final model answer reported the build marker and aggregate; the recorded turn ended `completed`, with no Agent errors or human interactions.

The complete Jev wire input matched the business ledger input: **24 questions, 24 candidates, 25 byte-mapped retained chunks, 34,360 request code points and zero unsubmitted candidates**. The persistent Session held exactly one non-error tool result. Its text and the original log shared SHA-256 `723954b2557d8c897936e99ee9f2a073b31302f27e2004603b47b24666f44205`. The existing credential file was read through the native provider and remained byte-identical; no existing user profile was changed.

The first real-task setup stopped before HTTP dispatch because the official headless template disables its credentials row. Its overlay initially configured a path without enabling that row. The validation overlay was corrected with `disabled: false`, and the successful task used a new evidence directory. The setup failure remains recorded separately. It required no product change.

## 边界与验证

This is one controlled task with real providers, native tools and filesystem effects. It does not establish natural-task accuracy, stable savings, latency or general reliability. The unchanged real output does not verify recovery after a live omission; deterministic tests cover that path.

The two passive DeepSeek SSE clones ended with `AbortError` while observing response metadata. The native task completed successfully; these observations do not indicate a product stream failure or constitute a complete DeepSeek wire capture. The Jev response was captured completely. HTTP status, actual judgment input, persisted tool output and filesystem results were checked separately. No additional paid request was made after the successful task.

The task-specific runner, exact commands and raw evidence remain local under ignored `.artifacts/`. Public files contain only aggregate facts and hashes; they exclude credentials, authenticated URLs, raw provider packets and Session captures.
