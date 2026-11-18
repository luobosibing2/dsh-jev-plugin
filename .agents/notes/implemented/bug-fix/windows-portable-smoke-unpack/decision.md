# Portable Windows smoke extraction

Status: implemented. [PR #56](https://github.com/luobosibing2/dsh-jev-plugin/pull/56) merged on 2026-11-03 as `0a7f94accb4267d6da3436956ae474fceb3d23f7`, resolving [#55](https://github.com/luobosibing2/dsh-jev-plugin/issues/55). Delivery confirmed during maintenance on 2026-11-04.

At main 81e6032 the compatibility runner adds GNU tar's --force-local on every Windows machine. Windows' bundled bsdtar 3.8.9 rejects that option before opening the archive, blocking documented installer/Host/Web checks after expensive preparation.

Run extraction from the archive directory with a basename instead of an absolute drive path. This avoids GNU remote-host parsing while using arguments shared with BSD tar. Keep the absolute extraction destination and existing command logging, failure handling and package validation.

No Host, plugin behavior, profiles or dependencies change. Existing Windows and Linux command-test jobs already run the regression file. The new test uses real tar with stubbed package preparation and intentionally stops at manifest validation after extraction.

Verification: the new regression failed before the fix (unpack exit 1) and passed after it on Windows BSD tar. All 95 tests across command/protocol/Remote and Host/wire suites, Host/Client typecheck and git diff --check passed. Full installer/Web and real-model checks are outside this fix's validation scope.

Both Linux and Windows command CI checks passed before merge (run 41365002542). This lifecycle move records that delivery; it does not claim a new full installer/Web or real-model run.
