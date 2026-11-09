# Delta specification

- The compatibility matrix must prepare its temporary fixture dependencies on Windows without symlink privileges, elevation or Developer Mode.
- Resolve the link target absolutely and use a Windows directory junction; preserve POSIX directory symlinks.
- Keep dependency resolution pointed at the selected official runtime, including paths with spaces.
- Preserve installer, Host failure reporting, zero-model fixture behavior and cleanup.
- Add a matrix entry-point regression that reaches a deliberate Host stop after successful dependency linking. Include it in the existing Linux/Windows smoke test surface.
- Align the English and Chinese smoke guide. No plugin runtime, supported-version declaration or user-profile changes.
