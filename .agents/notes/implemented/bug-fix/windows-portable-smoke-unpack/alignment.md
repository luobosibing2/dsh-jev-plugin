# Scope and acceptance

Issue #55 is a reproducible contributor compatibility-check failure, distinct from earlier npm shim and protocol-link fixes. Issue #53 requests a new decision backend and is unrelated; draft PR #54 depends on unshipped Host interruption APIs and is not modified.

Implement only the runner extraction call, regression and bilingual smoke documentation. Retain all user work and previous worktrees. No plugin source changes mean no runtime regeneration is needed. No real model calls, user profiles, credentials, package publication or merge is authorized.

Acceptance: regression fails on the original Windows invocation; real BSD tar extraction succeeds after the fix; existing command tests pass; typecheck passes; primary planning records match the task branch; explicit paths are committed and a fork PR references #55.
