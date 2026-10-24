# Agent Note: 允许零技能推荐

Status: implemented

## Problem

技能选择分别询问每个名称和摘要是否有助于任务，但原消费逻辑只排序并取前五，导致全部八项均为0.01时仍发布五项。去重产生的空输出只表示所选名称已展示，不能表达没有候选达到推荐条件。

## Decision

技能选择以 `probability ≥ skillMinProbability` 判断推荐资格，配置接受 `[0,1]` 内的有限数，默认0.5且包含等号。合格项按概率和原候选顺序排序，最多取 `skillLimit` 项，再按可见名称去重，不补位。`confidence` 不参与资格或排序。完整行为及验收要求由[最终 Delta Spec](delta-spec.md)维护；本文记录决策理由与取舍。

有效判断没有合格项时发布 `entries: []` 的正常目录，并记录 `skill-catalog-no-relevant`；有合格项但名称均已展示时保留 `skill-catalog-no-new` 且不新增目录消息。失败、取消、不完整或未采用不能成为成功零推荐。原生按名称加载和完整目录恢复继续可用，文件排序规则不变。

新目录的 `source.selection` 保存当次有效阈值和上限。维护中的分析器及预检使用这些参数，保留原始排名指标；旧记录无元数据时仍按历史无阈值top5解释。失败判断的实际选择为未确定，只有有效空选择才记为空数组。数量表单仍只编辑三个原有字段，保存时保留阈值；没有增加专用控件。

产品变更位于独立的 deepseek-jev 仓库，通过 [PR #37](https://github.com/luobosibing2/dsh-jev-plugin/pull/37) 合入 main，合并提交为 `40f4f33667377a31fd4c63593ae2619d8c1cc4af`。本组文档记录独立插件的交付，不改变 DSH 核心。原有改动先保存为 `5d552cc`，再安全整合 `origin/main@a2a2fdf`；最终 PR head 为 `c8d281a23083b475112f117aec6e8335b9592414`，与合并提交的文件树一致。

## Alternatives considered

**继续无条件 top K。** 不能满足全部候选不适用时零推荐的明确要求。

**可配置最低概率0.5（用户选择）。** 同一批128次评分可保留全部15次所需项，但还保留4次非所需项。它比0.8宽松，可能降低未知任务的漏选风险，也可能保留更多无帮助摘要；现有数据不能量化这些新任务风险。

**独立适用性分类。** 将资格与排名分开可以避免给当前概率直接设置通用含义，但需改变判定问题或协议消费，并取得新的分类样例；历史Noul分数不能校准新分类器。本次未做新模型调用，也不认为这一替代方案已经验证。

**可配置最低概率0.8（未采用）。** 对既有请求和响应改动最小，历史所需最低0.90与非所需最高0.58之间存在间隔。选择0.8在这些样例中保留所需并排除非所需，但该间隔并不能证明0.8是唯一或普遍最优阈值。用户选择更宽松的0.5；保留配置入口和完整目录恢复以支持明确的后续调整。

## Consequences

推荐数量可以是零到上限；低分项不再为填满数量而进入目录。先截断再去重的顺序保留，因此已展示项不会触发后续候选补位。已有摘要不删除，未入选技能仍可原生调用，完整目录恢复不调用判断模型。此改动不增加模型请求种类或调用次数，不扩展文件排序、完成核查、审批或通用 ToolSearch。

2026-10-17 对既有128次评分重新离线核对：默认0.5保留15/15次所需项、4/113次非所需项；全无关八项为0/8。15次所需项是案例重复计数，并非15个独立任务。阈值选择与评价使用同一批数据，没有留出集或边界附近的新真实样本；这不建立新任务效果、跨模型校准或通用准确率。固定测试只验证程序规则。

## Verification

2026-10-17 在复用的产品 worktree 隔离工作区（位置未公开） 完成以下验证；旧记录中的通过结果没有替代本次检查。

| 检查 | 实际结果 |
|---|---|
| `pnpm install --frozen-lockfile` | 依赖与更新后main一致 |
| `pnpm run typecheck` | Host与Client通过 |
| 四个selection/client Vitest文件 | 68项通过，覆盖阈值两侧与等号、非法值、三态、冻结与重试、取消、去重、回放和旧记录、原生加载与恢复、数量保存 |
| `python3 -m unittest bench.completion_skill.tests.test_skill_selection bench.completion_skill.tests.test_portable` | 17项通过，含新旧元数据、实际选择与原始排名、失败/取消/不完整及旧预检消费者 |
| `pnpm run test:compatibility --version 0.2.1-alpha.3` | 官方发布版安装、正式包逐文件核对、Host与认证Web通过；内含build，无付费模型调用 |
| 正式安装零推荐case | 实际Loader临时阈值1、固定Noul 0.99，正常空目录、独立成功回执、主Agent最终完成，无人工Retry/Cancel；配置随后恢复 |
| 构建后根runtime选择测试 | p=0.01与0.95两项通过；84个JS/声明文件与构建列表及内容一致 |
| 网站与说明 | 网站build、am patch零STE警告、MD与HTML源一致、其他面板保留、浏览器排版检查通过 |
| `git diff --check` | 通过 |
| [PR CI](https://github.com/luobosibing2/dsh-jev-plugin/actions/runs/39021188719) | Linux类型检查、全量单测、构建、runtime清洁检查及正式安装兼容性通过；Windows启动和协议准备检查通过 |
| [合并后CI](https://github.com/luobosibing2/dsh-jev-plugin/actions/runs/39021310301)与[网站部署](https://github.com/luobosibing2/dsh-jev-plugin/actions/runs/39021310340) | main的Linux/Windows检查全部通过，Pages部署成功；浏览器已读到公开技能小节中的0.5门槛与三种结果 |

未运行新的付费模型实验、Docker/Pier完整活动或全部版本/平台产品矩阵；本地正式安装使用macOS，CI正式安装使用Linux，Windows只验证其声明的启动与准备路径。历史报告和原始结果未改写，用户profile未修改，工作区和分支未删除。
