# Decision and delivery

The native AgentLoop claims messages before running the pre-step hook. A whole-step rejection after the claim discards all inputs claimed together. On upstream `c115bf4`, the fixture showed the loss of a direct user instruction queued alongside the unresolved child report.

Use the pre-step decision's message list to withhold the affected shared inbox messages by ID. Continue to reject a step with only withheld inputs or an unresolved native tool report that is already in history. The resulting admitted messages go through ordinary Host Session recording.

The same-step regression passed after the fix alongside the existing shared-finding cancellation and hook integration tests. [PR #66](https://github.com/luobosibing2/dsh-jev-plugin/pull/66) merged into `main` as `9ade9c22e636aff13837d8822b6c8b8c0e8e9aed` on 2026-11-18 and closed [Issue #65](https://github.com/luobosibing2/dsh-jev-plugin/issues/65).
