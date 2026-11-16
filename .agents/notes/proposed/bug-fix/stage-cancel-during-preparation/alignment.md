# Alignment: record stage cancellation during preparation

Issue [#71](https://github.com/luobosibing2/dsh-jev-plugin/issues/71) concerns a claimed stage step that is still preparing its judgment input when the user cancels the running batch.

Keep the change in Jev's stage worker and storage. A cancelled step must remain retryable without a judgment dispatch or a change to native Session history.
