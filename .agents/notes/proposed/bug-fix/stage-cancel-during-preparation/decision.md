# Decision: settle interrupted preparation as cancelled

On main `c115bf4`, a deterministic fixture holds the worker's request preparation, cancels the batch, and releases preparation. The batch reports one failure and no cancelled steps or saved record. The worker's abort falls into the same catch as storage errors.

Handle cancellation at the preparation boundary. Reuse the batched fingerprint when fresh preparation did not complete, and persist a cancelled record using the existing stage store. Leave the worker's storage failure handling intact. The issue is independent of the completed-batch memory retention change in PR #70.

The regression failed before the fix and now verifies one saved cancellation and no model requests. All 37 focused stage tests, Host and Client typecheck, and the production build passed using local fixtures.

Delivery status: proposed in [issue #71](https://github.com/luobosibing2/dsh-jev-plugin/issues/71).
