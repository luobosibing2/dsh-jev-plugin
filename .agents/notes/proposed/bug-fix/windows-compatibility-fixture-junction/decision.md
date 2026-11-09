# Decision and verification

Status: proposed; no confirmed merge. Fixes https://github.com/luobosibing2/dsh-jev-plugin/issues/59.

On main d2b7229 the matrix unconditionally requested a directory symlink. The Windows probe using official DSH 0.2.2-rc.1 installed successfully (exit 0), then failed with EPERM at fixture-prepare before any model request. This is distinct from completed protocol-reference and tar portability fixes.

Use an absolute dependency target with a junction on Windows and a directory symlink elsewhere. The regression uses a disposable CLI fixture and sentinel module; it asserts installer exit 0, successful module resolution, and the deliberate Host exit 42 reported at host-fixture. No real DSH profile is launched by that regression. The new regression failed on the original source at fixture-prepare and passed after the fix.

Verification: frozen dependency install; 17 tests across compatibility smoke commands, feature coverage, protocol preparation and generated Remote helper; Host/Client typecheck; staged whitespace check. No plugin source changed, so runtime regeneration is unnecessary. POSIX execution awaits Linux CI; this check does not establish full Windows Host/Web compatibility or resolve #58.

The branch also carries the previously recorded #56 planning lifecycle move, whose identical authoritative documents were already present in the primary checkout.
