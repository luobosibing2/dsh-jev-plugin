# Agent Note: Count eligible generic admission candidates

Status: implemented

## Problem

通用日志的保留分组消耗了判断候选名额。超过 48 个总分组时，即使只有少量可判断噪声，准入也会提前放弃。补写时，聚焦回归已复现总分组误计和 48 候选被拒绝的问题。

## Decision

数量限制作用于最终候选，保留分组仍完整输入判断器并保留在输出。完整行为与验收由 [Delta Spec](delta-spec.md) 负责。[PR #33](https://github.com/luobosibing2/dsh-jev-plugin/pull/33) 已于上海时间 2026-10-17 01:37:21 合入插件 `main`，合并提交为 `22d4166607b3a24cd098279d76bb9a9bcd50a2a9`。本地 `main` 已安全快进到该提交，主工作区干净；实现工作区保留。

## Alternatives considered

**继续限制总分组数。** 该方式让无需判断的证据消耗候选名额，不能满足用户要求。

**扩大或重设上下文、输出预算。** 用户明确限定为候选计数修复；完整请求已有独立字符预算，修改这些设置会扩大范围。

## Consequences

原先因保留分组过多而跳过的日志现在可能发起一次合格判断。完整请求字符预算、候选上限和等待限制仍约束该行为。真实模型可以选择保留全部候选；单次任务不能证明普遍准确率或节省效果。

首尾及保留证据不占候选名额，仍完整保留；48 候选允许、49 候选放弃，不新增分组、协议、预算、错误处理或 DSH 底座修改。共享发现测试只等待真实持久化收据，产品逻辑、原断言、超时及重试不变。

## Verification

修改前新增用例 3 失败、2 通过；修改后四个日志准入测试文件 46／46 通过，typecheck 和 build 成功；根 runtime Hook smoke 3／3 通过，diff 检查通过。

macOS 官方 DSH 0.2.1-alpha.3 正式安装及 9 个 Host 组件、Web 设置和记录页通过，浏览器错误为 0。正式包 86 个声明/runtime 文件与构建一致，真实任务安装后 85 个 runtime/patch 文件一致；两个环境使用同一 tarball，SHA-256 为 `1487d2712bfb06fe4cf78729bc49738aff8135df5acb96e284f217e990b52862`。

一个真实 DeepSeek Flash＋Jev 任务用原生 bash 导入并检查 24 个 ESM 模块，24 份产物校验和一致、aggregate 为 300。51 个日志总分组形成 24 个候选和 25 段逐行匹配保留证据；实际 Jev wire state 与 ledger 相同，完整请求 34,360 码点，低于默认 48,000。DeepSeek 调用 2 次，Jev 调用 1 次，均 HTTP 200。候选 omit 概率为 0.58–0.67，均未达 0.8，持久工具输出与 10,111 码点原文哈希相同。构建产物探针另确认 48 允许、49 放弃；凭据源前后字节一致，用户 profile 未变。

首次隔离验证 overlay 未启用官方 headless 默认禁用的凭据行，在零模型请求时失败；修正验证配置后使用新目录通过，不涉及产品修复。两条 DeepSeek 被动 SSE clone 的 AbortError 仅限制完整流观测；原生任务 completed、无 Agent 错误，Jev 响应完整。该受控任务不证明普遍准确率、稳定省略效果或真实省略后的恢复。

PR 首轮 [CI](https://github.com/luobosibing2/dsh-jev-plugin/actions/runs/38939842391) 的日志准入 46 项及 Windows 命令检查通过，但已有共享发现测试的 1 秒轮询等待失败。该测试以真实 `delivery-root-queued` 持久化收据同步后，单项、所属文件 23 项、一次完整本地测试 30 文件／385 项均通过。现有日志不能定位首轮当时具体阻塞在队列、HTTP 还是持久化；没有将其归因于已证明的基础设施故障。

最终 PR 提交 `f51188bcb7a8c35075efe5aaa320d9de21480554` 的 [CI](https://github.com/luobosibing2/dsh-jev-plugin/actions/runs/38940805999) 两项检查均成功，包含类型、完整测试、构建、runtime 一致性、正式包兼容性及 Windows 命令检查。确认这些检查成功后执行 squash merge；合并后的产品、测试、runtime 和验证报告与受测分支一致。

合并提交 `22d4166607b3a24cd098279d76bb9a9bcd50a2a9` 的 [主分支 CI](https://github.com/luobosibing2/dsh-jev-plugin/actions/runs/38941103136) 也全部成功：Linux check 2 分 13 秒，Windows 命令检查 43 秒。

公开脱敏结果见插件 [验证报告](https://github.com/luobosibing2/dsh-jev-plugin/blob/22d4166607b3a24cd098279d76bb9a9bcd50a2a9/docs/testing/2026-10-17-admission-candidate-limit/README.zh-CN.md)。原始证据保留在隔离工作区 ignored `.artifacts/`，不进入 Git。

## Related

本组文档是 DSH 工作区内的本地跨仓库任务记录；实际代码在独立插件 隔离工作区（位置未公开），不表示 DSH 底座发生修改。Alignment、Delta Spec 和本 Decision 作为完整功能目录保留在 implemented/bug-fix，不属于 frozen archived 历史。
