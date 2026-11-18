# Decision: separate batch execution from its latest summary

On main `c115bf4`, a deterministic fixture ran ten stage reanalyses to completion. The Host still owned ten batch objects after they settled, and the last-batch entry also held the history and task inputs. The retention repeated on every analysis of the same Session.

Keep an active registry for cancellation and worker shutdown. Remove its entries after the worker settles, including errors, and skip registration for empty batches. Store only progress and claimed step identities in the latest-per-Session index. Keeping the entire latest batch and dropping only older entries would still pin a potentially large Session snapshot after work finishes. Saved results remain in the existing Stage store and Jev ledger.

The regression reproduced ten retained batches on main and verifies zero active entries after ten refreshes with the fix. All 38 focused stage Host, batch, integration, and Client tests passed, plus typecheck, production build, and import of the regenerated Host entry. The fixture checks which objects the long-running manager retains; it does not measure process RSS or live-provider behavior.

[PR #70](https://github.com/luobosibing2/dsh-jev-plugin/pull/70) merged into `main` as `35c9db5002781de32d17e9867fa2d88e167efb5b` on 2026-11-18 and closed [Issue #69](https://github.com/luobosibing2/dsh-jev-plugin/issues/69).
