---
title: Jev 轻量完成声明核查
subtitle: 当前实现的触发、输入、补充循环与验证范围
cols: 2
template: sheet
theme: blueprint
lang: zh
mode: light
date: 2026-10-14
---
只核查当前 turn 的用户要求、最新 Todo 与最终回答。
自动补充次数可配置，默认 3 次；首次核查另算。

[全部功能](dsh-jev-plugin.html) · [功能网站](https://luobosibing2.github.io/dsh-jev-plugin/) · [Markdown 源稿](https://github.com/luobosibing2/dsh-jev-plugin/blob/main/docs/explainers/jev-completion-flow.md)

## A 直接答案 {span=2 meta="普通完成核查的主流程"}
```flow TB
主模型按需维护 Todo -> 输出最终回答
输出最终回答 -> agent/turn-stopping
agent/turn-stopping -> {本 turn 用过 Todo？}
本 turn 用过 Todo？ -> 跳过完成核查: 否
本 turn 用过 Todo？ -> 组装完整核查输入: 是
组装完整核查输入 -> {输入在预算内？}
输入在预算内？ -> 提示核查未完成: 否
输入在预算内？ -> Jev 回答两个问题: 是
Jev 回答两个问题 -> 按结论结束或补充
```
功能启用时，普通根 Agent turn 才使用这条流程。
本 turn 用过 Todo 即可核查，不要求条目全部 completed。
前一 turn 的 Todo 不自动触发本 turn 核查。
后来清空清单也不会抹去本 turn 的 Todo 使用记录。
Todo 更新本身不触发 Jev；简单任务无需创建 Todo。

这是报告完整性与一致性核查，不是对产物的独立验收。
如果 Todo 与最终回答一致地错报事实，Jev 未必能识别。
核查在回答已展示后运行，保留原始回答与后续补充。

## B 主模型怎样提供依据？ {meta="沿用 content 与 status"}
插件通过 systemPrompt.section 提供简短提示。
仅在功能启用时提供，无需用户手工修改提示词。
不新增 Todo 字段，不要求事件编号或额外证据报告。

```callout info 更新已有 Todo 时说明真实结果
简述实际动作、产物路径或已执行命令及观察结果。
失败、未验证和未完成部分如实保留，不编造依据。
不增加用户未要求的验证，不强制把所有检查改成通过。
无需为了完成核查而给简单任务创建 Todo。
```

虚构示例，不是一次实际执行记录：

```json
{
  "content": "修复导出功能；src/export.ts；pnpm test export，12 项通过",
  "status": "completed"
}
```

测试是否必须通过，由用户要求决定。
“运行并报告测试”允许如实报告失败。
“修复并通过指定测试”在测试仍失败时尚未完成。

## C Jev 回答什么？ {span=2 meta="一次请求 · 两个 Choice"}
两个问题共享同一份输入，不是两次串行调用。

| 问题 | 输出 | 含义 |
| --- | --- | --- |
| assessment | complete | 报告显示要求已满足，未见明显遗漏或矛盾 |
| assessment | omission | 要求未交代、明确未完成或规定条件未满足 |
| assessment | contradiction | Todo 状态、完成说明或最终回答相互矛盾 |
| assessment | needs-user | 完成依赖未解决的用户选择或授权 |
| assessment | unknown | 所给材料不足，无法可靠判断 |
| focus | 已有要求、Todo 条目或最终回答 | 定位本次最关键问题 |
| focus | none 或整体材料 | complete 可用 none；整体不足可选整体材料 |

插件生成位置编号，再将所选编号映射回原文。
没有进入 Todo 的要求，也能通过用户消息定位。
提示由结论类别、原文引用和固定模板组成。
每次只指出最关键的一处，不宣称列出全部问题。

不要求 Jev 自由生成长理由，不增加第三个生成问题。
概率或 confidence 可留作诊断，不显示为任务正确率。
缺少答案、格式错误或不存在的引用，按响应错误处理。
有效 unknown 是业务结论，不属于技术错误重试。

## D 行为示例 {span=2 meta="说明预期，不代表真实判断准确率"}

| 情况 | 预期 |
| --- | --- |
| 本 turn 未使用 Todo | 不调用完成核查 |
| Todo 有 pending 项，主模型正常停止 | 仍核查，不因条目未全部完成而跳过 |
| 要求更新文档，报告未交代 | omission，通过用户要求定位 |
| 要求修复并通过测试，报告仍失败 | omission |
| Todo 写未验证，回答却说验证通过 | contradiction |
| 只要求运行测试，报告如实说明失败 | 可满足该要求，不强制修到通过 |
| 只有“全部完成”，无法判断真实结果 | unknown，额度内补充依据 |
| 完成依赖未决用户选择或授权 | needs-user，停止自动补充 |
| 三次补充后仍有问题 | 展示最后结论，不再自动补充 |
| 超预算或调用失败 | 提示核查未完成，等待重试或取消 |

补充后采用最新 Todo 与最新最终回答。
材料不足既不能证明任务失败，也不能证明任务完成。

## E 怎样补充与复核？ {meta="默认最多补充 3 次"}

| 结论或情况 | 后续行为 |
| --- | --- |
| complete | 记录报告核查结果，正常结束 |
| omission，尚有额度 | 提示遗漏，主模型在原授权内补做 |
| contradiction，尚有额度 | 引用矛盾位置，主模型核对并更正 |
| unknown，尚有额度 | 提示材料不足，主模型补充真实依据或说明 |
| needs-user | 交用户决定，不自动继续 |
| 补充后再次停止 | 用完整最新材料重新核查 |
| 额度耗尽仍有问题 | 展示最后结论，停止自动补充 |

omission、contradiction 和 unknown 共用补充额度。
初次核查不占额度，默认最多 3 次补充、4 次正常核查。
设置上限为 N 时，正常核查最多 N+1 次。
结论类别改变不重置计数，剩余额度也不必用完。
技术重试不计入正常核查次数，不消耗或重置补充额度。

补充通过 agent.steer 进入同一 turn，Todo 不因此清空。
主模型更新相关条目，不自动重做其他已完成项。
缺失材料如实说明，不编造结果，不强制 completed。
补充不增加验收条件，也不授予新的修改权限。

设置页的“最多自动补充轮数”按 profile 保存。
默认 3，接受正安全整数；非法输入保留有效配置。
保存参数不会启用功能，也不改变 Goal 的无进展计数。

## F 输入、预算与异常 {span=2 meta="完整材料通过预算检查后才发送"}

| 项目 | 规则 |
| --- | --- |
| 用户要求 | 本 turn 原始要求及适用调整；不能从 Todo 反推要求 |
| Todo | 完整最新清单，包含 content 与 status；可为空 |
| 最终回答 | 核查前最新最终回答；可为空 |
| 排除材料 | 原始工具结果、完整执行轨迹、reasoning 与跨 turn 要求 |
| 超预算 | 不裁剪、不自动摘要，不发送残缺输入 |
| 超长提示 | “核查材料超出预算，本次完成核查未完成” |
| 调高预算后重试 | 读取完整当前材料与已保存配置，不消耗补充额度 |
| 超时、接口或格式错误 | 提示核查未完成，保留回答，等待重试或取消 |
| 取消核查 | 结束核查，不将任务改写为成功或失败 |

新 turn 只说“继续”时，不自动导入上轮要求。
无法取得完整原始要求时，提示材料缺失并等待用户处理。
摘要或上一轮回答不能替代缺失原文。
插件自己的补充消息不是新用户要求或授权。

evidenceChars 默认 24,000 字符，上限 1,000,000。
预算包含实际判断材料及必要规则和引用。
字符预算不保证判断提供方的 token 容量。

## G 记录、时效与其他监督 {span=2 meta="保留原生生命周期与授权"}

| 情况 | 处理 |
| --- | --- |
| 输入、答案与结论 | 保存在 Jev 记录中，区分采用与未采用 |
| 补充次数与停止原因 | 可追溯；进入主模型的提示写入 Session |
| 重复处理或恢复 | 不重复派发同一补充，不恢复已用额度 |
| 补充后的核查失败 | 已请求的补充仍计入使用次数 |
| 新用户要求、原生中止或状态变化 | 先处理原生流程，不采用旧判断继续 |
| 动作记录失败或状态未知 | 不宣称成功，不盲目重复补充 |
| 原生 Goal turn | 使用原有 Goal 监督，不启动普通完成补充循环 |
| 跑偏提醒 | 保留原输入与后台提醒，不套用新报告核查规则 |

源码：[报告输入与问题](https://github.com/luobosibing2/dsh-jev-plugin/blob/main/packages/jev/src/completion-report.ts) · [监督与补充流程](https://github.com/luobosibing2/dsh-jev-plugin/blob/main/packages/jev/src/supervision.ts) · [包参考](https://github.com/luobosibing2/dsh-jev-plugin/blob/main/packages/jev/README.md#ordinary-completion-checks)

## H 边界与验证 {span=2 meta="程序行为验证与真实模型效果分别记录"}

| 验证范围 | 已核对内容 |
| --- | --- |
| 固定判定测试 | 当前 turn 输入、五类结论、补充次数、失败与恢复分支 |
| 设置组件 | 默认 3、保存 2、重挂读取、非法输入和独立开关 |
| 构建及正式安装 | runtime 同步、打包内容一致与隔离 Web 接入 |
| 隔离设置页 | 保存 2 后刷新与重启仍为 2；非法值被拒绝 |
| 功能隔离 | 保存次数不启用完成核查，Goal 无进展计数不变 |

固定回答验证程序输入与处理流程，不证明语义判断质量。
没有运行本功能的付费模型实验。
未测量真实 Jev 准确率、自然任务收益或平均费用。
旧实测使用已有证据核查语义，不能作为新语义效果依据。
本功能未重跑完整旧版矩阵或 Windows、Desktop 验证。

验证入口：[报告测试](https://github.com/luobosibing2/dsh-jev-plugin/blob/main/packages/jev/tests/completion-report.test.ts) · [监督测试](https://github.com/luobosibing2/dsh-jev-plugin/blob/main/packages/jev/tests/supervision.test.ts) · [组件测试](https://github.com/luobosibing2/dsh-jev-plugin/blob/main/packages/jev/tests/client-ui.test.tsx) · [历史验证范围](https://github.com/luobosibing2/dsh-jev-plugin/blob/main/docs/validation.md)
