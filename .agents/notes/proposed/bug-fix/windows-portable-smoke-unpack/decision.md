# Portable Windows smoke extraction

Status: proposed; focused fix prepared for upstream issue [#55](https://github.com/luobosibing2/dsh-jev-plugin/issues/55). No merge or delivery to main is claimed.

At main 81e6032 the compatibility runner adds GNU tar's --force-local on every Windows machine. Windows' bundled bsdtar 3.8.9 rejects that option before opening the archive, blocking documented installer/Host/Web checks after expensive preparation.

Run extraction from the archive directory with a basename instead of an absolute drive path. This avoids GNU remote-host parsing while using arguments shared with BSD tar. Keep the absolute extraction destination and existing command logging, failure handling and package validation.

No Host, plugin behavior, profiles or dependencies change. Existing Windows and Linux command-test jobs already run the regression file. The new test uses real tar with stubbed package preparation and intentionally stops at manifest validation after extraction.

Verification: the new regression failed before the fix (unpack exit 1) and passed after it on Windows BSD tar. All 95 tests across command/protocol/Remote and Host/wire suites, Host/Client typecheck and git diff --check passed. Full installer/Web and real-model checks are outside this fix's validation scope.
