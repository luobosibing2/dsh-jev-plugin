# deepseek-harness-jev

[English](README.md) | 简体中文 | [中文功能与实测网站](https://luobosibing2.github.io/dsh-jev-plugin/)

**DeepSeek Harness（DSH）的原生插件：使用 Jev 或 Luna Decisions 提供判断。**

`deepseek-harness-jev` 将 [DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness) 与 [TypeSafe AI 的 Jev](https://typesafe.ai/) 连接起来，为 Agent 提供技能与文件选择、任务监督、共享发现纠正、工具日志筛选、单次操作审批和历史轨迹阶段导航。12 项功能可在同一个 Jev 设置页分别开启，默认全部关闭。

主模型继续负责规划、生成回答和调用原生工具；已启用功能在 DSH 的技能目录、Agent 生命周期、工具结果与审批等扩展点使用已保存的 Jev 或 Luna Decisions 连接，再按对应功能应用结果。主模型由 DSH 单独配置。接入基于公开的 Cordis / DSH 插件接口，无需修改宿主源码。

这是独立社区项目，并非 DeepSeek 或 Jev 官方发布。当前属于早期插件，已针对 **DSH 0.1.7-rc.2** 验证；接口和模型判断都不构成正确性保证。

[中文功能介绍站](https://luobosibing2.github.io/dsh-jev-plugin/)逐项说明 DSH 原生触发节点、交给判断服务的信息，以及实际测试场景、结果和边界。

`main` 支持 Jev，以及通过 OpenRouter 或 OpenAI 使用 Luna Decisions；每个 profile 独立保存三套连接。[2026-10-07 公开报告](docs/testing/2026-10-07-luna-decisions/README.md)区分固定协议及安装、受控真实样例与真实 DeepSeek Flash 任务。官方 OpenAI 在这些有限样例中调用成功；OpenRouter 的唯一真实诊断返回提供方访问限制的 HTTP 403 后停止。这些结果不建立通用判断准确率或稳定任务收益。

## 包含哪些功能？

下表描述 `main` 分支。**每项功能都有独立开关，默认全部关闭**，安装插件不会自动开启。

| 功能 | 作用 |
| --- | --- |
| 技能选择（Skill selection） | 在技能目录发布前，对名称和摘要排序；主 Agent 仍通过原生 skill 加载正文。 |
| 文件排序（File ranking） | 对原生 glob 返回的路径排序，不追加文件扫描或正文读取。 |
| 跑偏提醒（Drift monitoring） | 在模型步骤之间检查进展，必要时提供一次非阻塞提醒。 |
| 完成核查（Completion checks） | 对照已有证据检查已展示的最终回答，最多追加一次补充处理。 |
| 持续目标监督（Goal supervision） | 检查原生目标完成申请，连续多轮没有进展时暂停。 |
| 用户约束提醒（Instruction guidance） | 读取当前用户要求及适用的 Agent 规则，必要时发送非阻塞提醒。 |
| 中途插话分流（Interjection routing） | 把运行中的纠正消息送到下一步骤，其他消息留待后续轮次。 |
| 共享发现纠正（Shared-finding corrections） | 比较已经共享的报告和消息，向受影响的接收者发送纠正。 |
| 通用长日志准入（Tool-output filtering） | 命令返回后可省略明确不需要的进度或重复提示，并提供原文恢复位置。 |
| 测试日志准入（Test-log filtering） | 保护失败、摘要、点名和慢测试，再判断普通通过明细是否仍有用。 |
| 工作区提权代审批（Workspace approval） | 仅在 workspace-write 下参与适用的原生单次提权；非肯定判断回到原人工审批。 |
| 阶段导航（Stage navigation） | 按需分类已记录的完整模型步骤，将连续阶段与轨迹原文关联。 |

![Jev 功能设置页：选择、监督、共享纠正和工作区审批等功能可分别开启](docs/images/jev-feature-toggles.png)

*较早版本的功能设置示例。截图展示 9 个开关及用户自行选择的状态；当前 `main` 包含上表中的 12 项功能，新安装时默认全部关闭。*

所有功能共用连接、按 profile 保存的设置、判断记录与操作回执。多数 Agent 功能面向存活的 Web 主会话；向子 Agent 发送纠正，不等于子 Agent 自动拥有其他 Jev 增强。

**功能分支不等于已合入 main。** 工具输出筛选已进入 `main`；`codex/jev-tool-output-admission` 保留开发快照。原生网页执行在 `codex/jev-native-web-execution`，该方向目前**暂停，普通网站效果未通过验收**。其他历史分支保留早期实现。切换前请看[分支状态](docs/branches.md)，本表始终以 `main` 为准。

## 阶段导航

网页客户端在“轨迹”后提供独立的**阶段导航**标签页。它读取已记录的轮次，不修改原始 Session。

独立的**阶段导航**开关默认关闭，同时控制页面可见性：开启后才显示标签，开启本身不调用 Jev；关闭时隐藏页面、取消未完成的分类，并保留已保存结果。用户手动选择已结束轮，或选择本会话尚未分析的已结束轮后，才开始分析。

每次分类覆盖一个完整 DSH 模型 step：已记录的 Think、正文、全部工具调用与配对结果。Jev 从六阶段及 `mixed`、`unknown` 中选一个；程序只在同一轮内合并连续相同标签。页面左侧保留多轮目录，右侧定位完整 step 原文，并可核对实际分类输入与回答。标签和 confidence 不表示工具成功或分类正确率。输入、保存与失败处理见[包参考](packages/jev/README.md#stage-navigation)。

## 网页端安装（推荐）

已经在使用 **DSH 0.1.7-rc.2 Web** 的用户，直接填写 GitHub 仓库地址即可，无需克隆源码、手动打包或登录 npm。

1. 打开 **侧边栏「插件」→「添加插件」**。
2. 在 **「包名或地址」** 中粘贴下面的 GitHub 地址，点击 **「安装」**。
3. 安装完成后点击 **「立即启用」**；若提示下次启动后加载，重启当前 DSH profile。
4. 进入 **Jev** 页面配置服务地址、模型和 API Key，再按需开启功能。

```text
https://github.com/luobosibing2/deepseek-harness-jev
```

![DSH 添加插件窗口，已填入 deepseek-harness-jev 的 GitHub 仓库 URL](docs/images/install-from-github.jpg)

*在「包名或地址」中粘贴仓库 URL，再点击「安装」。*

**插件启用与功能启用是两层开关：12 项 Jev 功能默认仍为关闭。** 安装作用于当前 Web 连接的 Host profile；Host 需可运行 pnpm 并访问 GitHub。仓库已包含可直接加载的插件入口和预构建文件，不会在用户机器上编译源码，也不要求发布 npm 包。

当前 GitHub 入口提供 `main` 的功能，不包含实验分支。历史 [v0.1.0 安装包](https://github.com/luobosibing2/deepseek-harness-jev/releases/tag/v0.1.0)不含新合入的日志筛选功能；需要自行修改代码时再看下面的源码构建步骤。

## 从源码安装（开发者）

需要修改代码或自行构建时，再使用以下步骤。已有 DSH Web 的普通用户直接使用上面的 GitHub 地址安装即可。

### 构建环境

- 推荐 Node.js **24.11 或更高版本**；发布构建使用 Node 24.14.1 检查。
- `PATH` 中可用的 pnpm **11.7.0**。
- DeepSeek Harness CLI **0.1.7-rc.2**。插件固定使用对应 DSH peer 包和 Cordis **4.0.4**，不自动承诺兼容更新版本。
- 在 DSH 中配置好主模型，以及所选 Jev 兼容 System One 服务或 Luna API 的凭据。

如尚未安装工具：

```sh
npm install --global pnpm@11.7.0 @deepseek-ai/dsh@0.1.7-rc.2
```

### 构建安装包

从源码构建 `.tgz`，再使用网页端或官方 CLI 安装。

```sh
git clone https://github.com/luobosibing2/deepseek-harness-jev.git
cd deepseek-harness-jev
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build
mkdir -p dist
pnpm -C packages/jev pack --pack-destination "$PWD/dist"
```

### 使用 CLI 创建独立试用 profile

也可以把上一步生成的安装包绝对路径填入已有 Web 的插件管理器。以下 CLI 方法用于另建试用环境。

初次试用请使用**尚未存在的新 profile 名**；示例使用 `jev`。先从 Web 模板初始化，再添加插件：

```sh
dsh --profile jev --from-default-profile web --dump-default-config > /dev/null
dsh plugin --profile jev add ./dist/dsh-jev-plugin-0.1.0.tgz
dsh --profile jev
```

第一条命令创建 Web profile 后退出，不启动应用。如果直接给新 profile 添加插件，DSH 默认只初始化基础配置，不会自动成为 Web 应用。官方安装器会加载插件的 bundle patch，无需手改宿主源码。

打开 DSH 输出的认证访问地址。在 DSH 中配置主模型，然后进入插件的 **Jev** 页面。

## 配置判断连接

1. 打开 **Jev → 设置与功能**，在**判断模型**中选择 **Jev** 或 **Luna Decisions**；Luna 还可在 **Luna API** 中选择 **OpenRouter** 或 **OpenAI**。
2. 检查完整请求地址和凭据引用。Jev 保留原自定义地址和模型；Luna 使用对应 API 的固定模型标识。
3. 保存连接，再通过凭据控件保存 API Key。每套连接分别保存地址和凭据引用，不要把密钥写入源码或仓库 URL。
4. 点击**测试连接**，发送固定 Choice、Score、Noul 问题。通过表示三类回答均完成协议校验，不表示实际任务判断质量。
5. 只开启需要的功能。所有已启用功能使用已保存判断连接；切换模型不会改变功能开关、阈值、数量参数或共用超时。
6. 在**判断记录**中核对本次连接、提供方返回模型、实际请求、原始响应、统一答案、已知用量和动作回执。

| 连接 | 默认完整请求地址 | 请求模型 | 默认凭据引用 |
| --- | --- | --- | --- |
| Jev | 原 System One 地址，例如 `https://api.typesafe.ai/v1/systemone` | 原模型，例如 `jev-latest` | 原引用，初始为 `JEV_API_KEY` |
| Luna / OpenRouter | `https://openrouter.ai/api/alpha/decisions` | `openai/gpt-6-luna-decisions` | `JEV_LUNA_OPENROUTER_API_KEY` |
| Luna / OpenAI | `https://api.openai.com/v1/decisions` | `gpt-6-luna` | `JEV_LUNA_OPENAI_API_KEY` |

两个 Luna 模型 ID 是指定 Luna Decisions 能力在不同 API 中的命名。所选 API 决定协议，包括 OpenAI 将 Noul 表示为 `predicate`；修改域名不会改变协议。合法自定义端点仍使用所选协议。切回后可恢复各套已保存连接，旧 profile 默认选择 Jev 并保留原值。

凭据状态只显示是否存在和可写，不读回密钥；“已配置”不表示连接测试通过。编辑后须先保存连接，再写入密钥或测试；连接改变后，旧密钥写入会被拒绝，旧诊断也不能成为新连接的结果。成功替换密钥后清空输入。读取、编辑和保存设置均不发送模型请求。

每次尝试使用开始时已保存的连接；之后的切换用于新尝试和人工重试。故障不会自动转向其他模型或 API。OpenRouter 超过 200 题时完整分批，所有批次共用原超时，全部完成后才向业务交付答案；部分失败仍保留实际网络数据和已知用量。配置及生命周期详情见[包参考](packages/jev/README.md#judgment-connections)。

选择功能默认取 5 个技能摘要，最多对 40 个 glob 命中排序，展示 12 条路径。超过上限时直接跳过判断排序，不会悄悄只判断前 40 个。监督功能默认每 6 个完成的模型步骤检查一次跑偏，连续 3 个原生目标轮次无进展则暂停。这些参数可调整，保存参数不会自动开启功能。

通用长日志准入和测试日志准入有独立开关，均默认关闭。命令日志从 6,000 个 Unicode 码点、可识别测试日志从 4,000 个码点开始处理；默认省略概率门槛为 0.8，判断最多等待 4 秒。设置页可调整这些及其他准入预算，保存预算不会开启功能。

## 行为与限制

- **提醒是建议。** 跑偏和约束提醒不会阻塞、取消工具，也不会强制主模型遵守。
- **完成核查的固定16槽诊断。** 初始错误由脚本种入，开启组的6/6个错误案例经真实Jev判断和DeepSeek补做满足核心要求；2/2个准确对照判为完成，均无补做。见[新诊断结果](docs/testing/2026-10-05-completion-recovery/public-results.zh-CN.md)。完成核查只审查已有证据，不独立运行测试；本诊断不能推出自然任务错误率或编码平均收益。历史长编码试次因默认证据预算裁掉原始要求，判断零采用、零自动补做，最终转入人工Retry/Cancel，见[旧报告](docs/testing/2026-10-02-completion-skill/README.md)。
- **审批只针对一次操作。** 不改变会话沙箱模式，不覆盖宿主固定检查。有效 approve 可返回 allowed-once，unauthorized 或 unknown 回原人工审批；技术故障保留人工 Retry/Cancel。
- **共享纠正有明确范围。** 它只处理已经共享的报告和消息，不读取所有 Agent 的内部探索；自动投递限当前存活的主 Agent 及其活跃、可继续的直接子 Agent。同一发现以不同形式上报时，仍可能产生重复纠正。
- **判断成功不等于执行成功。** 日志分别记录判断、采纳、许可发放和实际操作结果。
- **日志准入保留原文入口。** 它只在工具执行后调整符合条件的模型可见文本；DSH 即时 spill、工具输出上限和之后的上下文压缩仍生效。隔离真实 profile 的一次构建将 8,510 字符日志缩短了 75.7%。一次中性措辞的 180 项测试触发了测试日志判断，但省略概率低于 0.8，因此完整保留；该次不证明测试日志已有实际缩减效果。见[工具输出准入报告](docs/reports/2026-09-27-tool-output-admission.zh-CN.md)。
- **验证有范围。** 确定性测试证明集成流程，有限真实样例不能证明普遍语义准确率。详见[验证说明](docs/validation.md)。
- **Luna 任务结果保留未达预期与限制。** 前两个受控审批样例返回 `unauthorized`；后来的真实任务得到 `approve` 并执行一次原生 `allowed-once` 写入。真实构建日志在原默认参数下由 8,407 缩至 2,122 码点（74.76%），五个同分文件概率则未改变排序。[双语 Luna 报告](docs/testing/2026-10-07-luna-decisions/README.md)同时记录这些结果、原文恢复和未验证功能。

开启的功能会将相关任务上下文或操作内容发送到配置的判断服务。精确判断输入和回答保存在 profile 的本地插件记录中，主模型可见影响使用正常 DSH Session 记录。运行资料和凭据应保留为私有数据；公开源码历史不包含个人 QA 截图和原始会话抓取。

## 更新与移除

已有 profile 更新时，重新构建、打包，运行 `dsh plugin --profile jev add <新安装包路径>`，再重启该 profile。不要对已有 profile 重新执行 `--from-default-profile`。相同版本号的不同构建使用新的安装包文件名，验收更新时核对实际安装内容。

单项功能可在 Jev 页面关闭。移除整个包时，以当前 CLI 的 `dsh plugin --help` 为准。替换实验分支安装包可能移除该分支特有功能，替换前保留 profile 备份。

## 开发

项目名称为 `deepseek-harness-jev`；内部安装包与导入标识保留 `@dsh-jev/plugin`，与已有 profile 的插件配置一致。

仓库根目录是 GitHub 安装入口，`packages/jev` 保留开发源码；`pnpm run build` 会同步生成 `runtime/`，发布源码改动时应一并提交这些生成文件。

维护者可用 [DeepSWE 配对评测入口](bench/deepswe/README.zh-CN.md)评测编码任务，用 [glob 排序管线](bench/selection/README.zh-CN.md)验证固定路径选择案例。两者采用隔离的 DSH/Pier trial，将模型执行与离线检查、报告分开。[英文评测指南](bench/deepswe/README.md)提供编码任务工作流。

[完成核查与技能评测入口](bench/completion_skill/README.zh-CN.md)提供四个具名场景，包括`completion-recovery-16`，以及显式资源清单、新批次准备、无费预检、收费执行和离线报告。[新固定诊断](docs/testing/2026-10-05-completion-recovery/README.md)与[历史结果](docs/testing/2026-10-02-completion-skill/README.md)均和维护入口的验证分开。每次重跑记录脚本提交和源码哈希，依赖及凭据仍需在运行机器上可用。

[公开 glob 实验](docs/testing/2026-10-01-glob-ranking/README.md)记录六类合成案例与12次真实DeepSeek/Jev运行：4次成功Jev判断返回69项分数，0和41候选按规则旁路；报告保留质量负例、恢复检查、源码读取数与费用估算。历史运行使用固定的旧版插件产物，维护中的管线不表示当前main已重跑，也不表示通用任务成功率提高。

```sh
pnpm run typecheck
pnpm run build
pnpm exec vitest run packages/jev/tests/host.test.ts packages/jev/tests/wire.test.ts
```

按改动运行相关测试。没有明确授权时，不开启真实服务实验或使用他人的凭据。开发夹具和测试不会进入可安装 tarball。

- [包参考与消费者 API](packages/jev/README.md)
- [工作区审批集成测试](packages/jev/tests/workspace-approval.test.ts)
- [工作区审批 QA 用例](packages/jev/tests/workspace-approval-qa.md)
- [工具输出准入报告](docs/reports/2026-09-27-tool-output-admission.zh-CN.md)
- [分支状态](docs/branches.md)
- [验证说明](docs/validation.md)

### DSH 接入点

| 模块 | DSH 扩展点 | 源码 |
| --- | --- | --- |
| 技能与文件选择 | `agent/pre-step`、`tools/execute`、`tools/post-execute` | [selection.ts](packages/jev/src/selection.ts) |
| 监督与约束提醒 | `session/event`、`agent/pre-step`、`agent/turn-stopping`、`tools/pre-execute` | [supervision.ts](packages/jev/src/supervision.ts)、[instructions.ts](packages/jev/src/instructions.ts) |
| 消息分流与共享纠正 | 原生 Agent inbox、`agent/pre-step`、`tools/result`、子 Agent 消息 | [interjection.ts](packages/jev/src/interjection.ts)、[shared-findings.ts](packages/jev/src/shared-findings.ts) |
| 工具输出与测试日志筛选 | `tools/post-execute` | [output-admission.ts](packages/jev/src/output-admission.ts) |
| 单次提权审批 | `tools/execute`、`approval/request` | [workspace-approval.ts](packages/jev/src/workspace-approval.ts) |

## 许可证与致谢

MIT，见 [LICENSE](LICENSE)。安装包携带的第三方许可见 [THIRD_PARTY_NOTICES.md](packages/jev/THIRD_PARTY_NOTICES.md)。

功能研究受到 [Mu](https://github.com/qybaihe/mu) 启发。本项目通过公开扩展点实现 DSH 插件，不分发修改版 DeepSeek Harness、Mu 或 Cua runtime。DeepSeek Harness、Typert 工具和 Zod 保留各自声明。
