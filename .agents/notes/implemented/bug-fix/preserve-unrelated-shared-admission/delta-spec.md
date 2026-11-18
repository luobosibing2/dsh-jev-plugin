# Acceptance criteria

- Hold shared inbox input while its comparison is pending. If the comparison is cancelled or remains unresolved, keep the shared original and relation in the Jev business store and withhold that inbox message from the model.
- Admit other inputs claimed for the same step through normal DSH Session recording. A direct user instruction should reach the model exactly once.
- Preserve step rejection when all claimed inputs depend on an unresolved comparison, when the step is aborted, or when an unresolved native tool report is already in Session history.
- Reproduce the loss using native child messaging, a running root Agent, and a local deterministic judge. Confirm that cancellation leaves the relation unresolved and the shared message withheld while the separate user instruction is admitted.
