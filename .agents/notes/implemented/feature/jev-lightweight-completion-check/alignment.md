# Jev 轻量完成声明核查：当前对齐

当前授权：按已确认 Delta Spec 在独立 worktree 实施并运行必要测试，由 Sol 编写代码，主代理审查整合；用户于 2026-10-14 授权把 HTML 与代码一起合入，当前继续提交、推送、PR 检查和合并。实施对象是独立插件仓库 `deepseek-harness-jev`；此目录维护独立Jev功能的规划记录，不代表要修改 DSH。完整实施要求由 [Delta Spec](delta-spec.md) 承载，取舍由[已实施决策](decision.md)承载。

- 仅改变普通根 Agent 的 `completion-check`，保持原生 Goal 监督和其他 Jev 功能的行为。
- 只检查当前 turn，不做跨轮任务关联。输入为当前 turn 的原始用户要求及其后续调整、完整最新 Todo、最新最终回答。
- 当前 turn 没用 Todo 就跳过；用过 Todo 则在主模型停止时核查，不要求全部 completed。Todo 更新不触发 Jev。
- 主模型通过已有 Todo 的 content 简述实际动作、依据与结果。插件提供简短提示，不新增字段、模型工具、事件编号要求或独立证据报告。
- Jev 只核查报告是否覆盖要求、满足规定条件且前后一致，不检索匹配原始工具结果，不做独立功能验收。测试失败是否允许，由用户任务决定。
- 一次 Jev 请求有两个 choice 问题：assessment 与 focus。结论为 complete、omission、contradiction、needs-user、unknown；重点位置从插件提供的材料引用中选，支持无问题位置或整体材料不足。提示由类别、原文及固定模板构成，不增加生成式长理由。
- omission、contradiction、unknown 共用可配置的自动补充额度，默认 3 次。首次核查另算，正常流程最多 4 次 Jev 调用；补充仍在同一 turn，使用最新 Todo 与最终回答复核，类别变化不重置计数。
- complete 结束；needs-user 交用户决定；额度耗尽仍有问题则显示最后结论并停止自动补充。补充不扩大原授权，也不强制伪造依据或全部通过。
- 输入超过预算，不裁剪、不自动摘要；显示“核查材料超出预算，本次完成核查未完成”，允许调高已有字符预算后重试，不消耗补充额度。
- 超时、接口或返回格式错误显示“本次完成核查未完成”，保留主模型结果。沿用现有“重试/取消”；技术重试与主模型补充分别计数，不把技术失败当成 unknown。
- 核查发生在主模型回答已经可见之后。新要求到来后不能按过期判断继续补充。

会改变本次产品范围的未决问题：无。实施工作区：隔离工作区（位置未公开）；分支 `codex/jev-lightweight-completion-check`，从已 fetch 的 `origin/main` 创建。当前已授权提交、推送、创建 PR 并合入 main；用户另明确选择本次不录 GIF，完成检查后直接合入；付费模型调用、修改日常 profile 和清理工作区仍未授权。

本地实施与主代理审查已完成，改动保留在上述 worktree，代码与 HTML 已通过 PR #26 合入 main，必要的测试同步修复已通过 PR #27 合入，最终 main CI 通过。具体合并、安装与验证证据见[已实施决策的 Verification](decision.md#verification)；功能状态为 implemented，线上 Pages 部署另记实际状态。
