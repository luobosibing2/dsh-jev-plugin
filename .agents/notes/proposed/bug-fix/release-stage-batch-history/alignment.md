# Release stage batch history

- Objective: fix [issue #69](https://github.com/luobosibing2/dsh-jev-plugin/issues/69), where rerunning Stage navigation accumulates finished batches with their history and request inputs in Host memory.
- Scope: Jev's stage batch lifetime, the corresponding regression tests, and the GitHub installation bundle.
- Preserve the latest batch status, saved classification details, explicit cancellation and retry behavior. The DSH Session and the underlying Host APIs stay unchanged.
- Verify with deterministic test fixtures. No live model, user profile, or package publication is needed.
