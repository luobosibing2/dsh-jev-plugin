# Decision: delegate unqualified PowerShell script calls

On main `c115bf4`, PowerShell ran the PATH copy of a synthetic script for `& 'jev-path-check.ps1'`, but ran the workspace copy when given `& './jev-path-check.ps1'`. The DSH approval integration fixture showed that Jev sent the same-named workspace file for either a quoted or an unquoted bare name.

Delegate these recognized unqualified calls before claiming the native approval. The working directory does not establish what PowerShell will discover, and trying to reproduce its lookup in Jev would add an independent source of error. Explicit local paths and direct `pwsh -File` operands retain the existing file evidence. This is separate from the working-directory fix in #47.

Both regressions failed before the fix. All 43 workspace approval cases passed afterward with a localhost judge, including explicit path control cases. No live provider was used.

Delivery status: proposed in [issue #73](https://github.com/luobosibing2/dsh-jev-plugin/issues/73).
