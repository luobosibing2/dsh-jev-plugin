# Delta: do not judge the wrong PowerShell script

- When workspace approval recognizes a simple PowerShell call-operator invocation with a script name but no path, leave it to native approval. Do not read a same-named local file, dispatch a judgment, or issue an automatic grant.
- Continue to use the native working directory for explicit local paths, including relative shell working-directory overrides. A direct `pwsh -File` path remains eligible for evidence.
- Preserve the original tool arguments and native approval audit. Cover both quoted and unquoted bare names and verify explicit-path behavior with the native approval integration fixture.
