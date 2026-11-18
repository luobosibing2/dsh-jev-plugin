# Development guidance

This repository is an independent DeepSeek Harness plugin. Read [README.md](README.md) and the [package reference](packages/jev/README.md) before changing public behavior.

- Implement features through documented DSH extension points; do not patch DSH, Mu, or Cua as part of this project.
- Keep unrelated worktree changes intact. Stage explicit paths, not the entire checkout.
- Never commit credentials, local profiles, raw user-session captures, personal screenshots, or generated build artifacts outside the tracked root `runtime/` bundle. Regenerate and commit that bundle with source changes because the GitHub installation entry loads it directly.
- Keep English and Chinese README instructions and feature status aligned. Distinguish main from unmerged and paused branches.
- Run checks appropriate to the changed surface. Real model calls, changes to user profiles, and publishing require explicit authorization.
- Every registration owns a disposer. Model-visible effects use DSH Session records; auxiliary Jev decisions use the plugin ledger.
- Build and test from an isolated feature worktree. Maintain feature planning records under [.agents/notes](.agents/notes/README.md) in Git by default; honor an explicit request to keep particular material private. The root agent maintains the authoritative feature documents in the primary checkout and includes the same content in the task branch before a feature or documentation commit. Record confirmed delivery and lifecycle moves in Git. Planning records do not ship in the package; keep raw Sessions, credentials, personal profiles, and private experiment artifacts out of Git.
