# Preserve unrelated input during shared-finding cancellation

With Shared finding corrections enabled, a root Agent can receive a direct user instruction and a shared child report in the same step. Cancelling an unresolved comparison must preserve the unrelated instruction. Keep the existing guard for native tool reports that are already in Session history.

The daily maintenance task authorizes this focused fix using Jev's existing DSH hooks. [Issue #65](https://github.com/luobosibing2/dsh-jev-plugin/issues/65) records the reproduction and impact.
