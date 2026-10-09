---
template: doc
theme: blueprint
mode: light
lang: zh
style: 80
title: DSH Jev 插件：原理与全部 12 项功能
subtitle: 看清每项功能何时触发、给判断模型看什么，以及程序如何采用答案
date: 2026-10-09
source: dsh-jev-plugin · 79cdf650 · 差异核对 a3de7fc
---

[返回功能网站](https://luobosibing2.github.io/dsh-jev-plugin/) · [阅读 Markdown 源稿](https://github.com/luobosibing2/dsh-jev-plugin/blob/main/docs/explainers/dsh-jev-plugin.md)

主模型负责规划、回答和工具调用。DSH Jev 插件在指定节点加入结构化判断。下面按任务执行顺序，解释全部 12 项功能。

## 直接答案：这个插件如何工作

我们做的是 **DSH 的独立原生插件 `@dsh-jev/plugin`**。它通过公开扩展点接入宿主。当前 `main` 包含 12 项业务功能，每项都有独立开关，默认全部关闭。

### 三个参与者各做什么

| 参与者 | 职责 | 例子 |
| --- | --- | --- |
| DSH 主模型 | 理解任务，制定方案，生成回答，调用工具 | 搜索文件、修改代码、运行测试 |
| Jev 或 Luna Decisions | 根据提供的材料，回答预先定义的问题 | 哪条路径相关；记录是否支持完成 |
| 本地插件与 DSH | 校验答案，检查是否仍适用，采用结果 | 排序、加入提醒、发放原生单次许可 |

```sequence num
participants: DSH, 功能插件, 判断服务
DSH -> 功能插件: 扩展点触发已开启功能
功能插件 -> 功能插件: 组装并保存 state 与 questions
功能插件 -> 判断服务: 发送本次判断材料
判断服务 --> 功能插件: 返回有类型的答案和概率
功能插件 -> 功能插件: 校验、保存、检查目标是否仍有效
功能插件 -> DSH: 采用排序、消息、日志或审批结果
DSH --> 功能插件: 记录实际采用与执行结果
```

### Jev 的原理：材料与问题分开

`state` 是待判断的事实材料。`questions` 定义要回答的问题和允许的答案。同一请求中的问题共享 `state`，各自作答。候选名称或路径也可以写在题目中。

| 题型 | 含义 | 插件如何使用 |
| --- | --- | --- |
| Choice | 从给定选项中选择，并返回概率分布 | 判断跑偏、遗漏、消息路由、审批和阶段 |
| Noul | 返回“是”的概率 | 分别判断每个技能或路径是否相关 |
| Score | 在有序等级间评分，可以返回小数 | 主要用于连接诊断 |

TypeSafe 将 Jev 的训练方法称为 **RLCD**，即为校准决策训练模型。它的目标是输出决策与概率。校准要在一组预测上衡量。本插件的有限样例没有验证概率校准。

例如，日志候选得到 `omit` 后，程序还要检查概率门槛。`0.8` 是该功能的采用参数，不能直接解释为本项目有 80% 正确率。`confidence` 描述答案的不确定程度，也不代表业务结果已验证。

原理来源：[System One](https://docs.typesafe.ai/concepts/system-one)、[State](https://docs.typesafe.ai/concepts/state)、[RLCD](https://docs.typesafe.ai/introduction/machine-learning-primer)、[概率与 confidence](https://docs.typesafe.ai/confidence)。

### 公共服务让 12 项功能共用哪些能力

| 公共能力 | 当前行为 |
| --- | --- |
| 判断连接 | Jev、Luna / OpenAI、Luna / OpenRouter 三套连接 |
| 配置隔离 | 每个 DSH profile 独立保存连接、凭据引用、开关和参数 |
| 连接诊断 | 显式发送 Choice、Score、Noul；保存设置不发模型请求 |
| 判断记录 | 保存精确输入、原始响应、统一答案、已知用量和动作回执 |
| 输入与结果保存 | 输入保存失败就不发送；结果保存失败就不交付可用答案 |
| 重试 | `judge` 的失败等待人工 Retry / Cancel；Retry 刷新当前材料 |
| 后台判断 | `judgeOnce` 最多尝试一次，失败直接交回消费者 |
| 后端切换 | 新尝试使用新连接；故障不自动换模型或 API |

三个连接都投影到内部 `JevRequest = { state, questions }`。适配器负责协议转换。OpenAI 将 Noul 转为 `predicate`。OpenRouter 超过 200 题时分批，全部成功后才交付业务答案。

**判断成功、业务采纳、原生许可和实际执行分开记录。** 没有执行回执时，不能凭判断答案认定操作完成。失败回执也不能成为重复执行的理由。

来源：[12 项功能与默认状态](https://github.com/luobosibing2/dsh-jev-plugin/blob/79cdf65083f19bf5d9c76e3adfa0f3030f057bad/README.zh-CN.md#L17)、[内部类型](https://github.com/luobosibing2/dsh-jev-plugin/blob/79cdf65083f19bf5d9c76e3adfa0f3030f057bad/packages/jev/src/types.ts#L6)、[公共消费者 API](https://github.com/luobosibing2/dsh-jev-plugin/blob/79cdf65083f19bf5d9c76e3adfa0f3030f057bad/packages/jev/README.md#consumer-api)。

## 选择：哪些技能和文件先给主模型看

### 01 技能选择 · skill-selection

**解决的问题：** 技能目录较大时，先发布与当前任务相关的摘要。

| 环节 | 实际内容 |
| --- | --- |
| 触发 | 主 Agent 的 `agent/pre-step`，原生技能目录发布前 |
| state | 最近最多 2 条直接用户文本、1 条助手可见文本；默认合计 2,000 字符 |
| questions | 每个技能一道 Noul；题目包含技能名称和 description |
| 采用 | 按相关概率排序，默认先取前 5 个，再去掉 Session 已可见的名称 |
| 主模型后续行动 | 通过原生 `skill` 工具加载技能正文 |

**示例：** 用户要求分析退款逻辑。插件判断代码调查技能是否相关，再把入选摘要交给主模型。Jev 没有读取技能正文、工具结果或附件。

去重后不从第 6 名补位。主模型仍可直接调用未入选技能。`skill_catalog` 可恢复完整摘要目录，恢复不调用 Jev。判断失败走人工 Retry / Cancel。

来源：[任务上下文](https://github.com/luobosibing2/dsh-jev-plugin/blob/79cdf65083f19bf5d9c76e3adfa0f3030f057bad/packages/jev/src/selection.ts#L65)、[技能判断与目录采用](https://github.com/luobosibing2/dsh-jev-plugin/blob/79cdf65083f19bf5d9c76e3adfa0f3030f057bad/packages/jev/src/selection.ts#L227)。

### 技能选择的完整输入输出示例

**6 个技能摘要 → 一次请求、6 道 Noul → 6 个概率 → 默认选前 5 个。**

本例使用 Jev / System One 协议。技能名称、简介和概率都是演示值，不是真实模型实测。假设这 6 个技能都可由当前 Agent 调用，且尚未在 Session 中展示。

```flow
6 个技能摘要 -> 一次请求中的 6 道 Noul
一次请求中的 6 道 Noul -> Jev 返回 6 个概率
Jev 返回 6 个概率 -> 插件排序并取前 5 个
插件排序并取前 5 个 -> 主模型收到入选摘要
```

#### 用户提出什么任务

> 查一下退款金额算错的原因，修复代码，补上测试，并说明改动。

#### 输入：实际发送给 Jev 的请求

任务放在共享 `state` 中。每个技能的名称和简介放在对应问题的 `instructions` 中。插件没有把技能正文放进请求。

```json
{
  "model": "jev-latest",
  "state": {
    "context": [
      {
        "role": "user",
        "text": "查一下退款金额算错的原因，修复代码，补上测试，并说明改动。"
      }
    ]
  },
  "questions": {
    "candidate-0": {
      "type": "noul",
      "instructions": "Would this skill help the task? Skill: code-investigation. Description: 查找代码实现，追踪调用关系，定位相关文件。"
    },
    "candidate-1": {
      "type": "noul",
      "instructions": "Would this skill help the task? Skill: slide-generation. Description: 把材料组织成演示文稿。"
    },
    "candidate-2": {
      "type": "noul",
      "instructions": "Would this skill help the task? Skill: unit-testing. Description: 编写单元测试，覆盖正常情况和异常情况。"
    },
    "candidate-3": {
      "type": "noul",
      "instructions": "Would this skill help the task? Skill: technical-writing. Description: 说明代码改动、使用方式和验证结果。"
    },
    "candidate-4": {
      "type": "noul",
      "instructions": "Would this skill help the task? Skill: root-cause-analysis. Description: 从现象和证据中查找故障原因。"
    },
    "candidate-5": {
      "type": "noul",
      "instructions": "Would this skill help the task? Skill: code-editing. Description: 根据已确认的问题修改代码，并检查相关影响。"
    }
  }
}
```

这是一个请求体。`candidate-0` 到 `candidate-5` 是问题 ID，帮助插件把答案对应回技能。6 道题分别问“这个技能能帮助当前任务吗？”

#### 输出：Jev 返回的答案部分

下面省略用量等其他响应字段，只展示 6 道题的模拟答案。

```json
{
  "answers": {
    "candidate-0": { "noul": 0.88 },
    "candidate-1": { "noul": 0.03 },
    "candidate-2": { "noul": 0.91 },
    "candidate-3": { "noul": 0.61 },
    "candidate-4": { "noul": 0.95 },
    "candidate-5": { "noul": 0.83 }
  }
}
```

`candidate-4` 的 `noul: 0.95` 是该技能能帮助任务的估计概率。它不表示修复成功率为 95%。6 道题彼此独立，不要求这些概率相加等于 1。

#### 插件如何读取并排序答案

适配器将 `noul` 转为内部的 `probability`，保持概率值不变。例如，第 5 道题转为：

```json
{
  "id": "candidate-4",
  "kind": "noul",
  "probability": 0.95
}
```

随后，本地插件按概率排序，默认取前 5 个：

| 排名 | 技能 | 相关概率（演示值） | 默认前 5 个 |
| --- | --- | --- | --- |
| 1 | root-cause-analysis | 0.95 | 入选 |
| 2 | unit-testing | 0.91 | 入选 |
| 3 | code-investigation | 0.88 | 入选 |
| 4 | code-editing | 0.83 | 入选 |
| 5 | technical-writing | 0.61 | 入选 |
| 6 | slide-generation | 0.03 | 不入选 |

技能选择使用 Top 5，没有日志功能的 0.8 采用门槛。因此，本例中概率为 0.61 的第 5 名也会入选。若入选名称已在 Session 可见，插件会去重，不用第 6 名补位。

#### 输出：主模型最终收到的技能摘要

下面展示插件消息中的目录部分。技能顺序已经改变，演示文稿技能没有进入本次摘要。

```text
<available_skills>
- root-cause-analysis: 从现象和证据中查找故障原因。 (relevance probability 0.95)
- unit-testing: 编写单元测试，覆盖正常情况和异常情况。 (relevance probability 0.91)
- code-investigation: 查找代码实现，追踪调用关系，定位相关文件。 (relevance probability 0.88)
- code-editing: 根据已确认的问题修改代码，并检查相关影响。 (relevance probability 0.83)
- technical-writing: 说明代码改动、使用方式和验证结果。 (relevance probability 0.61)
</available_skills>
```

消息还要求主模型先调用原生 `skill` 工具读取正文。主模型可用 `skill_catalog` 恢复完整摘要目录。

**到这里，插件只筛选并发布了摘要。** 主模型之后决定加载和执行哪个技能。Jev 的入选结果不会自动执行技能。

格式来源：[问题组装](https://github.com/luobosibing2/dsh-jev-plugin/blob/79cdf65083f19bf5d9c76e3adfa0f3030f057bad/packages/jev/src/selection.ts#L256)、[Jev 请求编码](https://github.com/luobosibing2/dsh-jev-plugin/blob/79cdf65083f19bf5d9c76e3adfa0f3030f057bad/packages/jev/src/wire.ts#L65)、[Noul 答案转换](https://github.com/luobosibing2/dsh-jev-plugin/blob/79cdf65083f19bf5d9c76e3adfa0f3030f057bad/packages/jev/src/wire.ts#L117)、[目录消息](https://github.com/luobosibing2/dsh-jev-plugin/blob/79cdf65083f19bf5d9c76e3adfa0f3030f057bad/packages/jev/src/selection.ts#L140)。

### 02 文件排序 · file-ranking

**解决的问题：** 原生 glob 命中多条路径时，让相关路径先出现。

| 环节 | 实际内容 |
| --- | --- |
| 触发 | 主 Agent 的原生 glob 成功返回 `{ root, paths }` 后 |
| state | 任务文本、glob 的 pattern 和 path |
| questions | 每条候选路径一道 Noul；路径写在题目中 |
| 采用 | 对完整 paths 排序；概率相同保持原顺序 |
| 展示与恢复 | 默认展示前 12 条；完整带分数列表可通过原生 spill 回读 |

**示例：** glob 找到 `src/refund.ts` 和 `docs/refund-theme.md`。Jev 判断路径名称与任务的相关性。插件不会追加扫描，也不会读取文件正文。

默认最多判断 40 条候选。出现 41 条时，整次跳过判断排序。空候选也直接旁路。判断失败走人工 Retry / Cancel；重试复用已完成的 glob，不重复搜索。

来源：[glob 判断与结构化排序](https://github.com/luobosibing2/dsh-jev-plugin/blob/79cdf65083f19bf5d9c76e3adfa0f3030f057bad/packages/jev/src/selection.ts#L294)。
## 监督：有没有跑偏，记录是否支持完成

这三项共用已记录的可见证据。材料包含用户请求、助手正文、工具调用与结果，以及适用的原生 goal。监督排除 reasoning，不追加文件读取或验证命令。

每次判断都问两道 Choice：一道选结论，一道选支持结论的既有证据 ID。程序引用原始要求或记录来反馈。

### 03 跑偏提醒 · drift-monitoring

| 环节 | 实际内容 |
| --- | --- |
| 触发 | 默认每 6 个完成的模型 step 检查一次；并行工具仍算一个 step |
| 上下文 | 当前请求范围内的可见记录，或当前 goal revision 的记录 |
| 结论选项 | `on-track / drift / unknown`，另选证据 ID |
| 采用 | drift 在后续已进入的模型步骤加入一次普通 Session 提醒 |
| 失败与限制 | 后台 `judgeOnce`；失败不阻塞；已结束任务不会被唤醒 |

**示例：** 用户要求检查退款故障，模型却持续调整页面样式。Jev 可以选择某条用户要求，插件据此提醒主模型回到任务。相同要求不会在同一请求中反复提醒。

提醒送达不代表主模型一定改正，也不会取消已经执行的工具。

### 04 完成核查 · completion-check

| 环节 | 实际内容 |
| --- | --- |
| 触发 | 最终回答已展示，进入 `agent/turn-stopping` |
| 上下文 | 从原始请求到本次回答的记录，含工具结果和最终事实声称 |
| 结论选项 | `complete / omission / needs-user / unknown`，另选证据 ID |
| 采用 | complete 正常结束；首次 omission 最多排入一次原生 steer 补做 |
| 停止条件 | 再次遗漏或需要用户决定时，只记录说明，不再自动补做 |

**示例：** 最终回答声称“测试通过”，工具结果却记录失败。这个矛盾可算 omission。补做可以纠正报告，或完成已授权的遗漏工作。

```flow LR
最终回答已展示 -> 核对记录
核对记录 -> {结论}
结论 -> 正常结束: complete
结论 -> 最多一次补做: 首次 omission
结论 -> 停止自动补做: 再次遗漏或 needs-user
```

补做预约先持久保存，再排入消息，重启后不会因此重复补做。核查不能撤回已展示回答，也不独立重跑测试。原始任务只授权审查时，补做只能在该授权范围内行动。

### 05 持续目标监督 · goal-supervision

| 路径 | 判断材料与答案 | 本地行动 |
| --- | --- | --- |
| 每个原生目标轮结束 | 当前 goal、当前和上一轮可见记录；`progress / no-progress / needs-user / unknown` | progress 清零停滞计数；默认连续 3 轮 no-progress 暂停目标 |
| `update_goal` 申请完成 | 当前目标范围的完成证据；与完成核查相同的结论 | complete 保留原许可；omission 拒绝本次完成申请；needs-user 还会暂停目标 |

**示例：** 多轮操作没有带来新证据时，插件可以暂停目标。有效调查或排除假设也可算 progress。用户恢复目标后，停滞计数重新开始。

插件使用 DSH 原生目标轮次驱动。原生目标服务仍负责状态修改和轮次上限。人工直接完成目标也由原服务处理。

### 证据预算为何会改变采用结果

默认预算是 **24,000 字符**。程序按完整消息选取证据，并记录遗漏范围。如果范围内的必要证据被预算裁掉，`completeEvidence=false`，判断不能作为可用结论采用。高概率也不能补回缺失证据。

完成核查和目标监督使用交互 `judge`。unknown、证据不全或技术失败进入人工 Retry / Cancel。新请求、目标修改或取消会使旧答案失效。

来源：[证据与两道题](https://github.com/luobosibing2/dsh-jev-plugin/blob/79cdf65083f19bf5d9c76e3adfa0f3030f057bad/packages/jev/src/supervision.ts#L88)、[跑偏触发](https://github.com/luobosibing2/dsh-jev-plugin/blob/79cdf65083f19bf5d9c76e3adfa0f3030f057bad/packages/jev/src/supervision.ts#L272)、[完成与目标轮监督](https://github.com/luobosibing2/dsh-jev-plugin/blob/79cdf65083f19bf5d9c76e3adfa0f3030f057bad/packages/jev/src/supervision.ts#L299)、[目标完成申请](https://github.com/luobosibing2/dsh-jev-plugin/blob/79cdf65083f19bf5d9c76e3adfa0f3030f057bad/packages/jev/src/supervision.ts#L343)。

## 约束和协作：要求与新消息如何进入当前任务

### 06 用户约束提醒 · instruction-guidance

**解决的问题：** 工具操作可能偏离当前用户要求或适用规则。

| 环节 | 实际内容 |
| --- | --- |
| 触发 | 主 Agent 的 `tools/pre-execute`；启动检查后立即继续原工具 |
| state | 用户原文、明确声明为 instruction 的 Host 原文、适用规则段落；工具参数、cwd、显式路径和来源作用域 |
| questions | 每个原文段落一道 Choice：`conflict / no-conflict / undetermined` |
| 采用 | conflict 在后续已进入的模型步骤提醒，并引用具体原文 |
| 失败与限制 | 后台一次判断；证据不全或失败不采用，不阻挡原工具 |

**示例：** 当前要求是“只读检查”，工具却请求写文件。插件比较实际操作与原文要求，随后发出提醒。原生 sandbox 和审批仍独立生效。

默认证据预算 24,000 字符、最多 64 个来源。采用前会重读原文，防止使用过期规则。它只识别可取得的显式目标，不推断任意脚本的全部效果。

来源：[来源读取](https://github.com/luobosibing2/dsh-jev-plugin/blob/79cdf65083f19bf5d9c76e3adfa0f3030f057bad/packages/jev/src/instructions.ts#L151)、[判断与提醒](https://github.com/luobosibing2/dsh-jev-plugin/blob/79cdf65083f19bf5d9c76e3adfa0f3030f057bad/packages/jev/src/instructions.ts#L229)。

### 07 中途插话分流 · interjection-routing

**解决的问题：** 运行期间收到新消息时，区分当前纠正和后续工作。

| 环节 | 实际内容 |
| --- | --- |
| 触发 | 存活主 Agent 运行期间收到直接用户 inbox 消息 |
| state | 完整插话文本、消息 ID、历史可见文本片段、当前目标；附件只给类型 |
| questions | 一道 Choice：`correction / queue / unknown` |
| 采用 | correction 进入 `next-step`；queue 留到 `next-turn` |
| 失败与限制 | unknown 或失败等待人工 Retry / Cancel；不取消已开始的模型请求或工具 |

**示例：** “你查错文件了，应该看退款模块”属于当前纠正。“结束后再整理一份文档”属于后续工作。

消息内容和身份保持原样。同一目标队列保持到达顺序。编辑消息会让旧判断失效。它不读取附件内容；历史文本默认最多 12,000 字符。

来源：[插话输入与路由题](https://github.com/luobosibing2/dsh-jev-plugin/blob/79cdf65083f19bf5d9c76e3adfa0f3030f057bad/packages/jev/src/interjection.ts#L117)、[消息接纳](https://github.com/luobosibing2/dsh-jev-plugin/blob/79cdf65083f19bf5d9c76e3adfa0f3030f057bad/packages/jev/src/interjection.ts#L271)。

### 08 共享发现纠正 · shared-findings

**解决的问题：** 已共享的旧结论被新证据替代后，让实际接收者收到纠正。

| 环节 | 实际内容 |
| --- | --- |
| 触发 | 已共享的 Agent 消息、前台子 Agent 报告或可关联身份的后台报告 |
| state | 当前用户任务、旧报告和新报告的完整原文、作者、消息身份、实际接收状态 |
| questions | relation：`replacement / conflict / support / unrelated / unknown`；basis：新原文中的证据行 |
| replacement 采用 | 保留旧原文并标记被替代，向合资格的实际接收者发送新旧结论与证据 |
| conflict 采用 | 保留双方，请主 Agent 核实；插件不执行新的独立验证 |

**示例：** A 报告“缓存键缺失”。B 提供原始记录，证明键存在且问题来自过期值。只有新原文提供替代依据时，程序才把旧发现标为被替代。

更新更晚、作者不同或重复转述，都不足以证明新结论正确。插件不读 Agent 私有探索。自动纠正只发给存活主 Agent 和符合条件的直接子 Agent。

默认请求预算 48,000 字符。超限不会静默截短两份报告后采纳。unknown 或失败进入人工 Retry / Cancel。排入 inbox、模型实际收到、模型采用结论，是不同状态；采用仍可能未知。

来源：[双报告输入与题目](https://github.com/luobosibing2/dsh-jev-plugin/blob/79cdf65083f19bf5d9c76e3adfa0f3030f057bad/packages/jev/src/shared-findings.ts#L60)、[纠正投递](https://github.com/luobosibing2/dsh-jev-plugin/blob/79cdf65083f19bf5d9c76e3adfa0f3030f057bad/packages/jev/src/shared-findings.ts#L154)、[比较与采用](https://github.com/luobosibing2/dsh-jev-plugin/blob/79cdf65083f19bf5d9c76e3adfa0f3030f057bad/packages/jev/src/shared-findings.ts#L208)。

## 日志：哪些工具文本可以省略

这两项在工具执行后，通过 `tools/post-execute` 调整模型可见文本。命令已经执行，插件只判断符合规则的日志候选。

```flow
工具完成 -> 本地规则保护关键行
本地规则保护关键行 -> 提取候选片段
提取候选片段 -> Jev 判断保留或省略
Jev 判断保留或省略 -> {是否满足采用条件}
是否满足采用条件 -> 保存完整原文: 满足
保存完整原文 -> 交付省略标记与恢复入口: 保存成功
是否满足采用条件 -> 保留原结果: 不满足或判断失败
保存完整原文 -> 保留原结果: 保存失败
```

### 09 通用长日志准入 · output-admission

| 环节 | 实际内容 |
| --- | --- |
| 触发 | 可识别的长命令日志；默认从 6,000 个 Unicode 码点开始 |
| 输入 | 当前任务、命令信息、受保护上下文和候选进度或重复提示片段 |
| 问题 | 对候选问 Choice：`omit / keep / unknown` |
| 采用 | omit 的概率不小于 0.8 才考虑省略；概率缺失时读取 confidence |
| 失败与限制 | 默认最多等待 4 秒；失败、未知、低概率或存储失败都保留原结果 |

**示例：** 构建输出数百条数字进度。插件保护错误、摘要、首尾与关键行，再判断进度候选是否仍有用。没有识别到候选时直接旁路。

### 10 测试日志准入 · test-log-admission

| 环节 | 实际内容 |
| --- | --- |
| 触发 | 可识别测试日志；默认从 4,000 个 Unicode 码点开始 |
| 输入 | 任务与测试日志候选；本地先保护失败、摘要、点名测试和慢测试 |
| 问题 | 对普通通过明细问 Choice：`omit / keep / unknown` |
| 采用 | 使用独立开关，共用默认 0.8 门槛与 4 秒等待 |
| 特殊规则 | 完全相同的重复失败详情可由确定性规则合并，不必调用 Jev |

**示例：** 一百条通过明细和一条失败详情。失败详情先被保护，Jev 只判断普通通过候选。日志变短不必然来自模型判断。

两项功能都先保存完整原文，再提供恢复入口。默认净减少量至少 300 字符且至少 10%，才替换文本。structured value、status 和 error 保持原值。

恢复范围是这个 Hook 收到的文本。DSH 原生 spill、输出上限和后续上下文压缩仍会生效。它不能恢复上游已经丢掉的内容。减量文本是否进入下次模型请求，需要另外核对。

来源：[日志输入和题目](https://github.com/luobosibing2/dsh-jev-plugin/blob/79cdf65083f19bf5d9c76e3adfa0f3030f057bad/packages/jev/src/output-admission.ts#L129)、[保存与采用](https://github.com/luobosibing2/dsh-jev-plugin/blob/79cdf65083f19bf5d9c76e3adfa0f3030f057bad/packages/jev/src/output-admission.ts#L299)、[本地保护与候选规则](https://github.com/luobosibing2/dsh-jev-plugin/blob/79cdf65083f19bf5d9c76e3adfa0f3030f057bad/packages/jev/src/output-admission-rules.ts#L136)、[真实日志报告](https://github.com/luobosibing2/dsh-jev-plugin/blob/79cdf65083f19bf5d9c76e3adfa0f3030f057bad/docs/reports/2026-09-27-tool-output-admission.zh-CN.md)。

## 审批：何时允许一次工作区外操作

### 11 工作区提权代审批 · workspace-approval

**解决的问题：** 用户已经授权一次具体操作时，为适用的原生提权请求提供判断。

| 环节 | 实际内容 |
| --- | --- |
| 参与条件 | 原生 `workspace-write`、approval policy 为 `ask`，请求显式包含 `danger-full-access` 与 justification |
| state | 当前可见授权消息与 pending 消息、完整工具参数、cwd、目标路径、原生策略、可读取的简单直接脚本 |
| questions | 一道 Choice：`approve / unauthorized / unknown` |
| 采用 | 当前 approve 通过快照重验后，返回原生 `allowed-once` |
| 非肯定判断 | unauthorized 或 unknown 交回既有人工审批；技术失败使用 Retry / Cancel |

```flow
适用的原生提权请求 -> Jev 判断授权
Jev 判断授权 -> {答案}
答案 -> 重验当前操作快照: approve
重验当前操作快照 -> 原生 allowed-once: 仍适用
重验当前操作快照 -> 不采用旧批准: 已变化
答案 -> 原人工审批: unauthorized 或 unknown
原生 allowed-once -> 工具实际执行
工具实际执行 -> 单独记录操作结果
```

**示例：** 用户明确要求把指定内容写入一个工作区外路径。插件判断这次提权是否属于已授权操作。发放许可后，仍由原生工具执行并记录结果。

这项功能没有日志功能的统一 0.8 门槛。旧批准在任务、脚本、路径或策略变化后失效。它不改变长期 sandbox 模式；一次 approve 也不能证明工具执行成功。

来源：[审批输入与题目](https://github.com/luobosibing2/dsh-jev-plugin/blob/79cdf65083f19bf5d9c76e3adfa0f3030f057bad/packages/jev/src/workspace-approval.ts#L117)、[最后重验与单次许可](https://github.com/luobosibing2/dsh-jev-plugin/blob/79cdf65083f19bf5d9c76e3adfa0f3030f057bad/packages/jev/src/workspace-approval.ts#L265)、[审批参考](https://github.com/luobosibing2/dsh-jev-plugin/blob/79cdf65083f19bf5d9c76e3adfa0f3030f057bad/packages/jev/README.md#workspace-approval)。

## 复盘：把历史模型步骤归到哪个阶段

### 12 阶段导航 · stage-navigation

**解决的问题：** 在长轨迹中找到调查、规划、实施和验证所对应的原始步骤。

| 环节 | 实际内容 |
| --- | --- |
| 触发 | 用户手动选择已结束轮，或尚未分析的全部已结束轮 |
| state | 一个完整目标 step：已记录 Think、正文、全部工具调用及配对结果；当时有效的用户要求 |
| 前序材料 | 默认前 2 个 step，每个摘要最多 700 字符 |
| questions | 一道 Choice：六阶段加 `mixed / unknown` |
| 采用 | 同一轮内，相邻、连续且有效的相同标签可合并；点击定位完整原文 |

```tree list
历史步骤的主要目的
  输入解析 | 识别任务输入和约束
  问题理解 | 调查事实、原因和未决问题
  方案规划 | 选择或修改方法
  实施 | 修改、调试及相关测试
  审查验证 | 检查已有结果是否满足要求
  交付收尾 | 整理证据与交付
  mixed | 多个主要目的无法拆开
  unknown | 记录不足以判断
```

开启功能只显示页面，不立即调用服务。关闭会隐藏页面并取消未完成分类，已保存结果保留。默认请求预算 48,000 字符；超限就不能分析，目标 step 不被截短。

**与监督的输入区别：** 阶段导航会发送已记录的 Think。监督会排除 reasoning。图片和文件只发送存在标记及元数据，插件没有把附件字节转换为原生图片输入。

来源指纹包含连接身份。换后端后，旧结果不能冒充新判断。阶段标签只描述步骤目的，不能证明分类正确或该阶段成功。

来源：[完整 step 输入与八种标签](https://github.com/luobosibing2/dsh-jev-plugin/blob/79cdf65083f19bf5d9c76e3adfa0f3030f057bad/packages/jev/src/stage-input.ts#L10)、[输入预算与指纹](https://github.com/luobosibing2/dsh-jev-plugin/blob/79cdf65083f19bf5d9c76e3adfa0f3030f057bad/packages/jev/src/stage-input.ts#L78)、[页面与分析服务](https://github.com/luobosibing2/dsh-jev-plugin/blob/79cdf65083f19bf5d9c76e3adfa0f3030f057bad/packages/jev/src/stage-navigation.ts)。

## 边界与验证

### 12 项功能是否都经过真实 Luna 验证

**没有。** 当前源码实现了 12 项功能。2026-10-07 公开报告的真实 Luna 业务样例只覆盖下面 3 项。其余 9 项不能借用 Jev 历史结果来证明 Luna 效果。

| 功能 | 公开报告中的真实 Luna 业务覆盖 |
| --- | --- |
| 01 技能选择 | 未报告 |
| 02 文件排序 | 有限样例；真实任务五条路径同分，原序不变 |
| 03 跑偏提醒 | 未报告 |
| 04 完成核查 | 未报告 |
| 05 持续目标监督 | 未报告 |
| 06 用户约束提醒 | 未报告 |
| 07 中途插话分流 | 未报告 |
| 08 共享发现纠正 | 未报告 |
| 09 通用长日志准入 | 有限样例；真实续验 8,407 → 2,122 码点，缩减 74.76% |
| 10 测试日志准入 | 未覆盖；运行退款测试不等于触发该功能 |
| 11 工作区提权代审批 | 两次受控授权未自动批准；另一个真实任务获一次许可并执行 |
| 12 阶段导航 | 未报告真实 Luna 业务分类；存在固定响应接线测试 |

官方 OpenAI 渠道的受控阶段有 6 次成功请求，其中 1 次是诊断；真实主模型阶段另有 3 次 Luna 请求。OpenRouter 唯一真实诊断返回 HTTP 403 访问限制，没有成功业务答案。

### 已有证据分别证明什么

| 证据 | 支持的结论 | 不能推出的结论 |
| --- | --- | --- |
| 当前源码与配置 | 功能存在，输入、触发、采用规则可追溯 | 在用户当前 profile 已开启或已触发 |
| 历史 27 文件 / 300 用例 | 当次固定协议、生命周期与接线集合通过 | 300 次真实语义判断正确 |
| Jev 固定完成诊断 | 开启组 6/6 个种入错误经判断与补做满足核心要求 | 自然任务错误率或编码平均收益 |
| 真实 Luna 日志续验 | 一次真实模型请求收到减量文本，原文可恢复 | 普遍缩减比例、准确率或成本收益 |
| 真实 Luna 单次审批 | 一个指定操作完成许可与执行链路 | 稳定可靠性，或先前拒绝原因已解决 |

提醒、判断和最终业务结果需要分别核对。过去样例中，约束提醒送达后主模型仍未修正错误陈述。跑偏提醒的真实样例也因任务已结束，没有进入后续请求。

阶段导航属于当前主分支。原生网页执行仍是暂停实验，普通网站效果未通过验收，不属于这 12 项已合入功能。

### 如何使用这份网页

先配置连接并显式诊断，再按任务需要开启单项功能。核对结果时，查看实际输入、统一答案、动作回执与原生 Session。多数 Agent 功能面向存活主会话；子 Agent 收到纠正，不代表拥有全部增强。

本页主体依据固定源码 `79cdf650` 与公开报告。另核对了主分支 `a3de7fc` 的差异。新增修复拒绝响应中的非有限 JSON 数值，保留原始文本供诊断；12 项业务功能不变。

本次核对没有调用真实模型，也没有重新执行产品验收。历史数量和结果都保留其日期与样例范围。

资料入口：

- [源码与功能概览](https://github.com/luobosibing2/dsh-jev-plugin/blob/79cdf65083f19bf5d9c76e3adfa0f3030f057bad/README.zh-CN.md)、[公共判断服务参考](https://github.com/luobosibing2/dsh-jev-plugin/blob/79cdf65083f19bf5d9c76e3adfa0f3030f057bad/packages/jev/README.md)。
- [新增 JSON 响应记录修复](https://github.com/luobosibing2/dsh-jev-plugin/commit/e4eafb9)、[核对后的上游提交](https://github.com/luobosibing2/dsh-jev-plugin/commit/a3de7fc170ddac413f9e5d822dbe399346c215fd)。
- [Jev 监督与纠正样例](https://github.com/luobosibing2/dsh-jev-plugin/blob/79cdf65083f19bf5d9c76e3adfa0f3030f057bad/docs/testing/2026-09-27-jev-hooks/public-results.zh-CN.md)、[固定完成诊断](https://github.com/luobosibing2/dsh-jev-plugin/blob/79cdf65083f19bf5d9c76e3adfa0f3030f057bad/docs/testing/2026-10-05-completion-recovery/public-results.zh-CN.md)。
- [Luna 受控与真实任务报告](https://github.com/luobosibing2/dsh-jev-plugin/blob/79cdf65083f19bf5d9c76e3adfa0f3030f057bad/docs/testing/2026-10-07-luna-decisions/public-results.zh-CN.md#L31)、[总体验证说明](https://github.com/luobosibing2/dsh-jev-plugin/blob/79cdf65083f19bf5d9c76e3adfa0f3030f057bad/docs/validation.md)。
