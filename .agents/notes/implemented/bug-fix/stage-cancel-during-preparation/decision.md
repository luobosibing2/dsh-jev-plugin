# Decision: settle interrupted preparation as cancelled

On main `c115bf4`, a deterministic fixture holds the worker's request preparation, cancels the batch, and releases preparation. The batch reports one failure and no cancelled steps or saved record. The worker's abort falls into the same catch as storage errors.

Handle cancellation at the preparation boundary. Reuse the batched fingerprint when fresh preparation did not complete, and persist a cancelled record using the existing stage store. Leave the worker's storage failure handling intact. The merged implementation retains the batch cleanup and latest progress summary from [PR #70](https://github.com/luobosibing2/dsh-jev-plugin/pull/70).

The regression failed before the fix and now verifies one saved cancellation and no model requests. All 37 focused stage tests, Host and Client typecheck, and the production build passed using local fixtures.

[PR #72](https://github.com/luobosibing2/dsh-jev-plugin/pull/72) merged into `main` as `e48caca27b198f829dbf03a1d465ba6d67cffc87` on 2026-11-18 and closed [Issue #71](https://github.com/luobosibing2/dsh-jev-plugin/issues/71).

The integrated change passed 43 stage tests, type checking, the production build, the generated entry import, and the [PR checks](https://github.com/luobosibing2/dsh-jev-plugin/actions/runs/44239469510).
