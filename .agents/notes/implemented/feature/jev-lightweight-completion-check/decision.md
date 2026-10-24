# Agent Note: Jev 轻量完成声明核查

Status: implemented

## Problem

普通完成核查从可见执行轨迹收集材料，长任务会携带大量工具输出，预算取舍又可能丢失用户要求。用户需要主模型在正常工作中简述实际依据，由 Jev 核查报告完整性与一致性，功能验收继续由主模型承担。

## Decision

普通根 Agent 的完成核查只读取当前 turn 的原始用户要求及适用调整、完整最新 Todo 和最新最终回答。本 turn 从未写 Todo 就跳过；用过 Todo 后即使清空清单，仍保留核查资格。Todo 更新本身不触发核查，核查在回答已展示后的正常停止点运行。

功能启用时，插件通过已有 systemPrompt.section 提示主模型在现有 Todo content 中说明实际动作、路径、命令与观察结果。不新增字段、模型工具、事件编号要求或独立整理轮次。失败、未验证与未完成事项如实保留，不增加用户未要求的验收。

一次请求只包含 assessment 与 focus 两道 Choice。结论是 complete、omission、contradiction、needs-user、unknown；focus 从实际要求、Todo 与最终回答的引用选项中选择。插件用固定模板引用选中原文，不要求判断模型自由编写长理由。每次只处理最关键问题。

omission、contradiction、unknown 共用 profile 设置 maxSupplementRounds，默认三次自动补充；首次核查另算，正常流程最多四次判断。补充通过 agent.steer 进入同一 turn，用最新材料复核；类别变化不重置额度。complete 正常结束，needs-user 交用户决定，额度耗尽则保留最后结论并停止自动补充。

发送前检查完整输入的字符预算。超长不裁剪、不额外摘要，也不发送残缺材料；原始要求缺失、预算拒绝、接口或格式错误沿用人工重试/取消。技术重试不消耗或重置补充额度。新用户要求到来后不采用旧判断。补充计数、采用结果和停止原因保存在已有记录中，进入主模型的提示写入 Session；动作投递未确认时不盲目重放。

原生 Goal 监督、跑偏提醒与其他 Jev 消费者保留各自输入和流程。普通完成核查不套用到 Goal turn、子 Agent 或诊断请求。

完整行为和验收由同目录的 [Delta Spec](delta-spec.md) 承载，[当前对齐](alignment.md)保存已确认范围。产品位于独立 deepseek-jev 仓库；本组三份文档记录该功能的规划与实际交付。

## Alternatives considered

**目录分页后让主模型整理证据。** 用户认为额外目录、关联状态与整理轮次过重。采用正常 Todo 更新时写依据，保留原执行流程。

**程序匹配 Todo 声明与原始工具记录。** 用户选择直接核查报告，因此不维护路径、命令及原始输出的匹配。代价是不能独立发现 Todo 与最终回答一致的虚假声明。

**让 Jev 独立验收产物。** 判定模型只接收材料并回答有限选择，功能验收由主模型负责。complete 不表示代码、产物或执行事实已经独立验证。

**核查无 Todo 的所有请求。** 用户选择无 Todo 跳过，使简单任务无需为核查创建清单；这些请求没有本功能覆盖。

**把有效 unknown 当作技术错误，或直接结束。** 用户选择让主模型补充真实依据，与遗漏和矛盾共用额度。接口与格式失败继续走人工重试，避免失败授权重跑业务任务。

**固定一次或无限补充。** 采用可调上限，默认三次，首次核查另算。有限补充提供更正机会并限制新增执行成本，耗尽不保证任务已完成。

**自动关联上轮任务或自动摘要超长材料。** 首版只覆盖当前 turn；超长由用户调整预算后重试。上一轮回答和摘要不替代缺失原文。

## Consequences

主模型报告可能完整且一致地错误，本功能不能承诺识别这种错误。单次只定位一个重点，多次补充仍可能留下其他遗漏。新一轮只说“继续”不会自动恢复上轮要求，未使用 Todo 的工作也不会触发核查。

自动补充增加主模型执行及判定成本，额度不包含用户主动的技术重试。已有只读与操作授权继续约束补充。输入进入已配置的判断连接及现有记录，不增加新的外部服务。

字符预算包含实际请求的材料、规则和引用选项，不能保证判断提供方的 token 容量。设置保存、界面接入和固定响应流程验证不证明自然任务判断质量。

## Decision ownership

历史[完成核查评测](../../testing/jev-completion-skill-evaluation/decision.md)与[补做诊断](../../testing/jev-completion-evidence-rerun/decision.md)继续拥有各自方法和历史结果，不据此宣称轻量核查有效。

协调研究（原本地材料未公开）中原始要求与工具证据配对、固定一次补充的方向由本决策部分替代；其他功能研究与历史结果保留。判定后端及阶段导航决策不受影响。没有冷归档、删除或改写历史记录。

## Negative guarantees

核查不新增模型工具或 Todo 字段，不读取匹配原始工具结果，不默默截断要求，不增加默认摘要轮次，不把概率显示为任务正确率。判断不授予新修改权限，也不强制把失败改成通过。

技术重试不清零已用额度；重复处理不重复派发同一补充；过期结果不采用；状态未知不宣称投递成功。核查不扩大到 Goal、子 Agent 或其他监督消费者。

## Verification

2026-10-15（北京时间），代码、tracked runtime 与两篇 HTML 通过 [PR #26](https://github.com/luobosibing2/dsh-jev-plugin/pull/26) 实际合入 main，合并提交 feed3917ab0b47cc6c5427a01380447429f14d8b。必要的测试同步修复通过 [PR #27](https://github.com/luobosibing2/dsh-jev-plugin/pull/27) 实际合入，当前已核对 main 为 c5ea794ab2a7b179c3119dc523a06b9128390af1；实施工作区与该提交的文件树一致；确认独立插件主仓库 main 干净且仅落后后，已 fast-forward 到同一提交，未重置用户改动。工作区保留在 隔离工作区（位置未公开），未删除分支或工作区，未发布 npm 包。

Sol 负责实现、必要测试与文档；主代理审查、整合、安装验证和实际合并。最终验证区分确定性分支、原生安装与 Web 接入、真实模型效果。

| 验证 | 实际结果 |
| --- | --- |
| 冻结安装 | pnpm install --frozen-lockfile 通过 |
| 类型 | pnpm run typecheck 的 Host 与 Client 通过 |
| 最终完整插件测试 | 29 个文件，373/373 通过 |
| 构建 | pnpm run build 通过，tracked runtime 重建无差异 |
| 默认正式兼容检查 | pnpm run test:compatibility，DSH 0.2.1-alpha.2 通过 |
| 最旧正式兼容检查 | pnpm run test:compatibility --version 0.1.7-rc.1 通过 |
| 每个正式包 | 86 项逐字节一致，包括 84 个 runtime 文件、manifest 与 Cordis patch；官方安装退出 0 |
| 每个宿主 | 9/9 Host ACTIVE；实际 Web 检查通过；页面、控制台与导入错误为 0 |
| 普通完成接入 | 原生 Todo 触发自己的 succeeded 记录；实际原要求、完整 Todo、最终正文、两个 Choice、五类结论和 completion-checked receipt 断言通过 |
| Goal 隔离 | native-goal 与 shared-reports 不启动普通完成核查 |
| 设置交互 | 默认 3；保存 2 后刷新及重启保持；0 被拒绝；功能仍关闭，Goal 计数不变 |
| HTML 与网站 | 两页源稿和 am-source 完全一致，STE 零警告；缺少源稿与不一致负例被拒绝；网站构建通过，新页亮暗渲染已检查 |
| CI 与站点 | [PR #26 CI](https://github.com/luobosibing2/dsh-jev-plugin/actions/runs/38596058355)、[PR #27 CI](https://github.com/luobosibing2/dsh-jev-plugin/actions/runs/38598578283)与[最终 main CI](https://github.com/luobosibing2/dsh-jev-plugin/actions/runs/38598950746)均成功；Pages 构建通过，首轮发布超时；部署 attempt 2 成功，线上 HTML 与已提交文件逐字节一致 |

原始本地实现曾通过 369 项，再以相关 23 项覆盖最后恢复修正；整合最新 main 后最终 373 项全套通过。兼容夹具增加原生 Todo 及完成核查自己的断言，避免把开关启用或其他功能记录当作核查已执行。

合入后同一代码树的两次 main CI 在既有共享冲突测试的默认一秒轮询失败，分别看到 undefined 和合法的前置 unconfirmed 状态。该用例没有启用完成监督。必要的局部测试同步修复改为等待 delivery-root-queued receipt 成功，再等待 Agent 空闲，保留原有所有强断言，未改产品与 runtime。受控 gate 暂停前置记录超过一秒时，旧轮询拒绝，新 Promise 保持 pending；释放后原断言通过。shared 文件 23/23、类型和最终 373/373 全套通过。此证据证明固定轮询不足，不推断 CI 额外耗时的具体来源或产品投递有缺陷。

兼容测试使用临时 profile 与本地固定回复，真实模型调用为 0。未修改日常 profile；用户明确选择本次不录 GIF。没有完整五版本矩阵、Windows Host/Web、Desktop、Hub 或自然任务效果验证；Windows CI 只覆盖包管理器命令检查。

本地正式包证据位于实施 worktree 的忽略目录 .artifacts/temp/compatibility-smoke-wrVIUz 与 compatibility-smoke-646vEL；设置证据在 .artifacts/stage-validation。受控同步实验在 .artifacts/ci-shared-sync-zl6_220n。原始资料不进入发布包。此前单独 peer 诊断的未通过与同路径 tarball 缓存误取，保留为开发阶段事实；最终正式安装与字节检查另有通过证据。

网站源码、两页生成 HTML 与必要构建接入都已实际合入。GitHub Pages 的[发布流程](https://github.com/luobosibing2/dsh-jev-plugin/actions/runs/38596498821)首轮在 updating_pages 状态持续约十分钟后超时，已重试部署 job；部署 attempt 2 随后成功；[线上新页](https://luobosibing2.github.io/dsh-jev-plugin/explainers/jev-completion-flow.html)读取成功，并与已提交 HTML 逐字节一致。此前部署未完成时的新页 404 不作为当前状态。此前本地方案页已同步为仓库内的当前实现说明。此部署状态不改变 main 的实际合并状态。
