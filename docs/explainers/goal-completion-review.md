---
title: Goal 监督与完成补做：快速复习
subtitle: 沿当前源码回看入口、判断、采纳、送达与验证边界
lang: zh
template: doc
theme: blueprint
date: 2026-10-17
---
## 直接答案
两条流程各有自己的续跑方式。Goal 由 DSH 原生机制续轮；插件检查进展和模型的完成申请。普通请求在回答展示后核查本轮报告，需要时补充，默认最多 3 轮。

[快速复习目录](https://luobosibing2.github.io/dsh-jev-plugin/#quick-review) · [轻量核查流程导读](https://luobosibing2.github.io/dsh-jev-plugin/explainers/jev-completion-flow.html) · [Markdown 源稿](https://github.com/luobosibing2/dsh-jev-plugin/blob/main/docs/explainers/goal-completion-review.md)

| 对比 | 原生 Goal 监督 | 普通完成核查与补充 |
| --- | --- | --- |
| 解决什么问题 | 连续轮次停滞，或过早申请完成 | 本轮报告遗漏要求、前后矛盾或缺少说明 |
| 交给判断器什么 | Session 已记录证据与当前 Goal | 本轮用户要求、最新 Todo、最新助手正文 |
| 谁继续工作 | 原生 Goal 轮次驱动 | 插件 steer，同一 turn 补充 |
| 数量限制 | 默认连续 3 轮无进展暂停 | 默认最多 3 轮自动补充，首次核查另算 |
| 完成结论的含义 | 允许原生完成工具继续处理 | 现有报告看起来满足要求 |

两类结论都不等于独立验收产物。Jev 提供判断，宿主检查是否仍可采纳，原生工具或主模型执行后续动作。

## 从三个入口读源码
入口集中在 `supervision.ts`。`agent/pre-step` 记录本轮归属；停止点选择一条流程；工具执行前检查模型的 Goal 完成申请。

```flow TB
agent/pre-step -> 记录本轮请求与Goal归属
记录本轮请求与Goal归属 -> agent/turn-stopping
agent/turn-stopping -> {Goal仍活跃？}
Goal仍活跃？ -> 检查本轮Goal进展: 是，且监督开启
Goal仍活跃？ -> {本轮属于Goal？}: 否
本轮属于Goal？ -> 结束本次监督: 是
本轮属于Goal？ -> {普通核查开启且本轮写过Todo？}: 否
普通核查开启且本轮写过Todo？ -> checkReport: 是
普通核查开启且本轮写过Todo？ -> 结束本次监督: 否
```

`requestId` 标记任务来源，`completionRequestId` 指向本轮原始直接用户消息。`ownsGoalTurn` 防止 Goal 在本轮完成或暂停后，又进入普通补充循环。

Todo 清空后仍算本轮使用过；上一 turn 留下的 Todo 不算。Todo 更新本身不会触发核查。

另一入口是 `tools/pre-execute` 中的 `update_goal`、`action=complete`。其他 Hook 已拒绝时直接保留拒绝；允许的调用才交给 Goal 完成核查。状态最终由原生 Goal 工具修改。

源码：[pre-step 归属](https://github.com/luobosibing2/dsh-jev-plugin/blob/1dbf5ce3fa8df61ba30324f59e52b435128066b8/packages/jev/src/supervision.ts#L311) · [停止点和完成工具](https://github.com/luobosibing2/dsh-jev-plugin/blob/1dbf5ce3fa8df61ba30324f59e52b435128066b8/packages/jev/src/supervision.ts#L389)

## Goal：已有证据怎样变成判断
`evidence()` 从 Session 的 `deriveMessages()` 取记录，过滤 reasoning。它不会重新读文件、运行测试或制造证据。

| 项目 | 当前处理 |
| --- | --- |
| 进展检查 | 当前 Goal revision 最近两轮的记录，加当前 Goal |
| 活跃 Goal 的完成核查 | 当前 revision 各轮的记录，加当前 Goal |
| 超出 evidenceChars 预算 | 裁掉放不下的记录，标记 completeEvidence=false |
| 完整性不足 | 不采纳结论，进入既有 Retry / Cancel 处理 |
| 两个 Choice | assessment 选择结论；evidence 指向已有要求或记录 |

进展结论为 `progress / no-progress / needs-user / unknown`。有效 `progress` 把连续无进展计数清零；`no-progress` 加一。达到 `noProgressRounds=3`，或得到 `needs-user`，暂停原生 Goal。

同一 Goal 轮次不会重复计数。Goal 身份变化时，重置 `stalled` 和 `lastRound`。

Goal 的 `unknown` 不能作为有效业务结论。证据选项无效或输入被裁剪也不能采用。技术失败或无法判定时，由用户选择重试或取消；同一 Goal 的核查取消会暂停原生续轮。

| 模型申请 complete 时的结论 | 插件动作 | 仍需区分的事实 |
| --- | --- | --- |
| complete | 放行原来的工具调用 | 放行之后，原生工具才处理授权和状态修改 |
| omission | 拒绝完成申请，返回所选记录 | 该结论本身不自动暂停 Goal |
| needs-user | 拒绝完成申请，并暂停 Goal | 等用户解决真实选择或授权问题 |

源码：[证据范围与完整性](https://github.com/luobosibing2/dsh-jev-plugin/blob/1dbf5ce3fa8df61ba30324f59e52b435128066b8/packages/jev/src/supervision.ts#L57) · [计数与完成申请处理](https://github.com/luobosibing2/dsh-jev-plugin/blob/1dbf5ce3fa8df61ba30324f59e52b435128066b8/packages/jev/src/supervision.ts#L400)

## 普通请求：只核查本轮报告
`completionReport()` 读取三项：本轮原始要求及已进入 Session 的调整、完整最新 Todo（`content/status`）、最新助手正文。Todo 可为空，正文也可为空。

它不直接携带原始工具结果、推理或 Goal 历史。Todo 与回答可能同时错报事实，因此不能代替独立产物验收。

| assessment | 含义与后续 |
| --- | --- |
| complete | 报告看起来满足本轮要求，结束 |
| omission | 有遗漏或未满足条件，有额度时请求补充 |
| contradiction | Todo 与最终报告矛盾，有额度时请求更正 |
| needs-user | 存在未决选择或授权，停止自动补充 |
| unknown | 材料不足，有额度时补真实依据或说明不确定性 |

第二题 `focus` 选择已有要求、Todo 项、最终回答或整体材料。`none` 仅允许与 `complete` 配对。每次只指出最关键的一项问题。

合法 `unknown` 是普通报告核查的业务结论，与 Goal 不同。答案格式或引用无效、接口错误等技术失败走 Retry / Cancel。

缺少原始要求或完整请求超预算时，`completionPreflight()` 在发送前拒绝。这里不裁剪、不自动摘要；重试会读取当前材料和配置。新 turn 只说“继续”，不会自动导入旧要求。

源码：[输入和两题](https://github.com/luobosibing2/dsh-jev-plugin/blob/1dbf5ce3fa8df61ba30324f59e52b435128066b8/packages/jev/src/completion-report.ts#L26) · [发送前检查与答案校验](https://github.com/luobosibing2/dsh-jev-plugin/blob/1dbf5ce3fa8df61ba30324f59e52b435128066b8/packages/jev/src/completion-report.ts#L62)

## 从有效答案到同轮补充
判断请求分成 `refresh → interpret → canAdopt`。先读取当前输入，再验证答案，最后确认任务和执行状态仍允许采用。

Goal 身份包含 `id/revision/phase`。版本还包含最近直接用户消息 ID，以及 nextStep、nextTurn 中待处理的直接用户消息 ID。普通核查进一步检查待处理用户消息内容。任务或 Goal 已变化的旧答案会被标记 `not-adopted`；原生取消走 `cancelled`。

```flow TB
有效且仍可采纳的报告问题 -> {还有补充额度？}
还有补充额度？ -> 保留末次结论并停止: 否
还有补充额度？ -> 持久记录reserved: 是
持久记录reserved -> 再核对当前状态
再核对当前状态 -> 标记stale并停止: 已变化
再核对当前状态 -> steer进入next-step: 仍有效
steer进入next-step -> 记录queued
记录queued -> Session出现user/message
Session出现user/message -> 记录delivered
```

`omission / contradiction / unknown` 共同使用 `maxSupplementRounds`，默认 3。首次核查不占补充额度，正常最多 4 次判断、3 次补充。技术重试不消耗或重置已用补充额度。

原回答已经展示，补充不会撤回它。补充沿用原授权，只处理最关键问题，并如实更新 Todo。失败、未完成和未验证结果必须保留；不强制把测试改成 PASS。

源码：[共用判断服务](https://github.com/luobosibing2/dsh-jev-plugin/blob/1dbf5ce3fa8df61ba30324f59e52b435128066b8/packages/jev/src/index.ts#L344) · [普通核查与预留、入队](https://github.com/luobosibing2/dsh-jev-plugin/blob/1dbf5ce3fa8df61ba30324f59e52b435128066b8/packages/jev/src/supervision.ts#L252)

## 为什么要区分预留、入队和送达
`requestId` 归属原请求，`operationId` 标识一次判断及其动作。`supplementUsage()` 合并 Session 中的 supplement 消息与同请求账本的 reserved 记录，按 operationId 去重；未送达且明确标记 stale 的预留不占额度。

| 记录或情况 | 能确认什么 | 如何处理 |
| --- | --- | --- |
| reserved | 已持久占用一次额度 | 保存失败就不入队 |
| queued | steer 已把补充放入队列 | 不等于已进入 Session |
| Session user/message | 原生消息已进入 Session | 尝试写 delivered 回执 |
| delivered | 消息已被接纳 | 不等于模型已执行或任务成功 |
| 只有 reserved，没有 queued 和 Session 消息 | 动作状态无法确认 | 标记 unconfirmed，阻止盲目重发 |
| queued 或 delivered 回执失败 | 可能已经入队或送达 | 保留额度，依据实际记录去重 |

`processedStops` 跳过已经处理的同一停止点，防止重复判断与补充。重启后恢复计数和去重，不等于自动恢复执行；需要原生流程或显式输入再次唤醒。

源码：[额度、去重与未确认状态](https://github.com/luobosibing2/dsh-jev-plugin/blob/1dbf5ce3fa8df61ba30324f59e52b435128066b8/packages/jev/src/supervision.ts#L206) · [Session 送达回执](https://github.com/luobosibing2/dsh-jev-plugin/blob/1dbf5ce3fa8df61ba30324f59e52b435128066b8/packages/jev/src/supervision.ts#L354)

## 教学例子与面试口述
以下是帮助理解机制的示例，不是新实验结果。

| 示例 | 预期处理 |
| --- | --- |
| Goal 进展为 N、N、P、N、N、N | N 为 no-progress，P 为 progress；计数为 1、2、0、1、2、3，第 6 轮暂停 |
| Goal 申请 complete | complete 放行；omission 拒绝；needs-user 拒绝并暂停 |
| 要求只运行测试并报告；Todo 写 FAIL，最终说 PASS | contradiction 请求更正报告，无需把测试修成 PASS |
| 普通报告依次为 omission、unknown、contradiction、unknown | 前三次各补充一轮；第四次保留 unknown 并停止 |

面试可以这样说：

“我把 Goal 监督和普通报告核查分开。Goal 继续由宿主续轮，插件只判断进展和模型完成申请。普通请求只看本轮要求、Todo 和最终报告，按额度请求补充。”

“我还把答案有效、状态允许采纳、消息实际送达分开。判断期间任务可能改变，入队后回执也可能失败。因此，先预留额度，再复核状态和派发，并结合 Session 与账本防止重复。”

“这些机制限制重复补做和越权；真实判断质量要另测。报告核查没有重新读取产物，不能声称它独立证明代码正确。”

## 边界与验证
本页依据 `1dbf5ce` 源码核对。本次归档只检查文档和网站，没有新跑付费模型实验。本页不纳入另行开展的新实验，结果以对应验证报告为准。

| 证据类别 | 已有内容 | 能支持到哪里 |
| --- | --- | --- |
| 当前固定判定测试 | 输入范围、状态变化、Goal 计数、补充额度、回执故障和重开 | 验证程序行为，不测真实语义准确率 |
| 既有构建与安装验证 | runtime、正式包、隔离 Host/Web 接入 | 验证交付和接线，不是任务效果 |
| 历史完整插件 CI | 29 文件、373/373 用例通过 | 整个插件集合，不是本功能准确率 |
| 2026-10-05 旧版固定诊断 | 脚本预种错误，真实 Jev 与真实 DeepSeek 补充执行 | 错误开启组 6/6 核心满足；准确对照 2/2 零补充 |
| 2026-10-02 旧版长轨迹 | 裁剪丢失原始要求，零采用、零自动补做 | 展示旧输入预算的限制 |

旧实验使用执行证据核查，不能充当当前轻量报告核查的效果证明。早期短样例补齐后仍被判 omission；固定诊断也出现补做重跑测试、额外生成 pycache 的情况。应区分核心要求满足、最小动作和整份回答精度。

实现与测试：[报告测试](https://github.com/luobosibing2/dsh-jev-plugin/blob/1dbf5ce3fa8df61ba30324f59e52b435128066b8/packages/jev/tests/completion-report.test.ts) · [监督测试](https://github.com/luobosibing2/dsh-jev-plugin/blob/1dbf5ce3fa8df61ba30324f59e52b435128066b8/packages/jev/tests/supervision.test.ts) · [回执故障测试](https://github.com/luobosibing2/dsh-jev-plugin/blob/1dbf5ce3fa8df61ba30324f59e52b435128066b8/packages/jev/tests/supervision-receipt-review.test.ts) · [配置默认值](https://github.com/luobosibing2/dsh-jev-plugin/blob/1dbf5ce3fa8df61ba30324f59e52b435128066b8/packages/jev/src/supervision.ts#L17)

公开验证：[373 用例历史 CI](https://github.com/luobosibing2/dsh-jev-plugin/actions/runs/38598950746) · [旧版固定诊断](https://github.com/luobosibing2/dsh-jev-plugin/blob/main/docs/testing/2026-10-05-completion-recovery/public-results.zh-CN.md) · [旧版短记录与长轨迹](https://github.com/luobosibing2/dsh-jev-plugin/blob/main/docs/testing/2026-10-02-completion-skill/public-results.zh-CN.md) · [验证范围](https://github.com/luobosibing2/dsh-jev-plugin/blob/main/docs/validation.md)
