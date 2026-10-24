# Jev 规划文档公开与默认 Git 跟踪

用户要求提交 `.agents/notes` 中的规划材料，并明确选择两项：公开所有 Jev 相关规划文档（包括原位于 DSH 目录的历史材料），以及修改通用规划规则，让今后文档默认纳入 Git。现有“仅本地保留”规则在这两项范围内被本次明确要求取代。

公开范围为十组存于 DSH 的明确 Jev 历史文档、本次已合并的 Spill 预算协同三文件，以及本次发布任务文档。DSH 自身的 ChatGPT OAuth 规划不属于 Jev，不随本次公开。历史未交付、负结果、私有原始实验数据和验证限制不能因公开而改写为成功。

通用流程保留显式绑定、primary checkout 中的三文件权威、worktree 隔离、实际合并后再转 implemented、非 Git 原有行为和本地任务关联元数据；改为文档默认跟踪，不由 Hook 自动暂存、提交、推送或决定生命周期。

Jev 文档从 `origin/main@49d0994d8454162138ad8b13aa4cc235e76143f3` 建立 `codex/publish-jev-planning-records`。Superpowers 从与当前安装一致的 `57b575cf276cdfc1b5602d43f7bb0c7d42fec75f` 建立独立 `codex/version-feature-planning-documents`，只提交本次改动并通过干净本地插件发布更新未来会话。该源码分支包含八条尚未推送的既有提交，本次不默推或公开它们，也不混入 Jev MR。
