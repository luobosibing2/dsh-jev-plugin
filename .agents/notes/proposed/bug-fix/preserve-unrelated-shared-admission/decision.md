# Decision and delivery

The native AgentLoop claims messages before running the pre-step hook. A whole-step rejection after the claim discards all inputs claimed together. On upstream `c115bf4`, the fixture showed the loss of a direct user instruction queued alongside the unresolved child report.

Use the pre-step decision's message list to withhold the affected shared inbox messages by ID. Continue to reject a step with only withheld inputs or an unresolved native tool report that is already in history. The resulting admitted messages go through ordinary Host Session recording.

The same-step regression passed after the fix alongside the existing shared-finding cancellation and hook integration tests. Delivery is proposed under [issue #65](https://github.com/luobosibing2/dsh-jev-plugin/issues/65).
