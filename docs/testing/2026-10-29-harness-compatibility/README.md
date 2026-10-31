# DSH 0.2.1-rc.3 兼容验证（Windows）

本报告记录将插件开发基线从 DSH `0.2.1-rc.2` 升至 `0.2.1-rc.3`。这是确定性验证：使用官方发布包、可丢弃 profile 和本地固定回复，**真实模型调用为 0**。它证明安装与接线，不证明自然任务效果。

## 1. 变更范围

`0.2.1-rc.3` 相对 `0.2.1-rc.2` 只有 6 个上游提交，改动集中在客户端 UI：

| 上游变更 | 对本插件的影响 |
| --- | --- |
| 左侧栏、会话视图、右侧栏新增「更多」菜单（新增 `conversation.session.header.views.actions` 与 `sidebar.right.tab.guide.actions` slot；`pluginNavigation.openList()`） | 都是**新增**扩展点。插件不注册这些 slot，也不调用 `openList`，无需改动。 |
| `ConversationSessionHeaderInjected` 增加 `entryPins`、`entryActions`、`setPinned` | 插件只消费 `conversation.view`，不实现该注入面。 |
| `MessageSubmissionState` 增加 `newSession`、`agentPreset`；`DraftInitializationOptions` 增加 `whenDraftExists` | 插件不读取提交状态、不初始化草稿。 |
| 修复切换会话后「新会话」丢失未发送草稿 | 宿主侧修复，与插件无关。 |
| DeepSeek API Key 适配器改用账号登录模式更新模型列表 | 插件不接管模型列表来源。 |
| `ui-primitives` 的 Tooltip 定位重构、Menu 锚宽、新增图标 | 插件使用 `Button`、`SegmentedTabs`、`StateDot`、`Switch`、`Toast`，均在 rc.3 导出且签名未变。 |

结论：**rc.3 无破坏性变更**，插件源码零改动，只做版本基线与声明对齐。

## 2. 版本声明

开发依赖（根包与 `packages/jev`，共 65 + 63 个 `@deepseek-ai/dsh*` 包）全部固定到 `0.2.1-rc.3`。Cordis 侧保持 `4.0.5`（`@deepseek-ai/cordis`）、`1.0.6`（`cordis-plugin-loader`）、`1.0.5`（`cordis-plugin-group`），因为这三个包不使用 DSH 版本号。

peer 声明从 7 个精确版本扩展到 8 个，追加 `0.2.1-rc.3`：

```
>=0.1.7-rc.1 <=0.2.0-rc.2 || 0.2.1-alpha.2 || 0.2.1-alpha.3 || 0.2.1-rc.2 || 0.2.1-rc.3
```

原始 7 个版本的支持继续保留（正式包的安装与运行），本次不重跑旧版本矩阵，其历史结论见[2026-10-21 报告](../2026-10-21-harness-compatibility/README.md)。

`packages/typert-protocol-reference` 与 `scripts/sync-typert-protocol.mjs` 的协议版本断言同步改为 `0.2.1-rc.3`；生成器的 `facade.d.ts` 与官方 `remote-info` helper 打包逻辑不变。

## 3. 本轮执行的检查

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 依赖安装 | `pnpm install` | 通过；65 个 DSH 包解析到 `0.2.1-rc.3` |
| Host 与 Client 类型检查 | `pnpm run typecheck` | 通过 |
| 测试套件 | `pnpm test` | 31 个文件、458 个用例全部通过 |
| 构建 | `pnpm run build` | 通过 |
| `runtime/` 一致性 | `git diff --stat -- runtime/` | 87 个文件重建后与已提交版本**逐字节相同**（GNU/Linux 与 Windows 行尾归一后为空 diff），因此无需提交新的构建产物 |

`runtime/` 不变的原因：本次只有依赖版本号变化，官方 Typert 生成器在 rc.2 与 rc.3 之间打包内容一致（仅自身 `package.json` 的 `version` 字段不同），生成入口因此未产生任何差异。

## 4. 官方包安装与 Web 检查

```sh
pnpm run test:compatibility --version 0.2.1-rc.3
```

该命令从当前源码重建正式根安装包，准备精确版本 `@deepseek-ai/dsh@0.2.1-rc.3` 的官方 CLI，在一次性 profile 中执行官方 `dsh plugin add`，检查九个 Jev Host 组件激活，并用真实浏览器打开官方认证地址、进入 Jev 页面核对设置与判断记录。

| 项目 | 结果 |
| --- | --- |
| 官方 CLI 版本核对 | `0.2.1-rc.3` |
| 官方 `dsh plugin --profile compatibility add <tgz>` | exit 0 |
| Host 组件激活 | 9/9 ACTIVE（`jev`、`jev-selection`、`jev-supervision`、`jev-instructions`、`jev-shared-findings`、`jev-interjection-routing`、`jev-output-admission`、`jev-workspace-approval`、`jev-stage-navigation`） |
| Host 导出面 | 13 个 `exports` 全部可导入 |
| 功能开关 | 12 项均可列出并启用 |
| 判断服务诊断 | `ok: true` |
| 固定场景 | 6/6 通过（`session-a`、`session-b`、`native-cwd-switch`、`native-goal`、`shared-reports`、`skill-no-relevant`） |
| 日志省略采用 | 通过（通用日志与测试日志各产生省略） |
| 正式包文件一致性 | 89 个文件逐字节匹配新构建 |
| Web 页面 | `pageErrors`、`consoleErrors`、`importErrors` 均为 0；插件入口可见、设置 12/12 启用、判断记录页可读 |
| 正式 tarball SHA-256 | `1871bec9cc1f1bbbbe742cc3586ce44709cc8acd847f095b8538ff8b8ee3b142` |

该轮**真实模型调用为 0**，主模型与判断服务均为本地固定回复。

## 5. 平台说明

上一轮 rc.2 报告在 macOS 执行。本轮在 **Windows、Node `22.23.2`、pnpm `11.7.0`、Chromium `156.0.8078.4`** 上执行，因此本轮结果构成 Windows 的独立证据，不能与 macOS 结果互相替代。

本轮同时修复了兼容 smoke 链路在 Windows 上暴露的三处真实缺陷。它们都只影响验证脚手架，不改变产品行为：

1. **`tar` 盘符解析**：`tar` 把 `D:` 当作远程主机名，报 `Cannot connect to D: resolve failed`。修复为在 Windows 上传 `--force-local`。
2. **硬编码 `bash` 工具名**：Windows 官方 profile 注册的是 `pwsh`，夹具却固定调用 `bash`，导致 `unknown tool "bash"`。修复为按实际注册的 shell 工具解析（产品侧 `output-admission.ts` 与 `workspace-approval.ts` 本来已同时支持两者）。
3. **TAP 测试嵌套 spawn**：`node --test --test-reporter=tap` 在沙箱化的 Windows 子进程里二次 spawn 得到 `spawn EPERM`，测试日志因此未达到省略门槛，断言 `Generic and test logs must adopt deterministic omissions` 失败。修复为 `--test-reporter=tap --experimental-test-isolation=none`。

对照实验确认这三处都属于 Windows 既有限制而非 rc.3 回归：在修复 1、2 之后、修复 3 之前，同一份夹具在官方 **0.2.1-rc.2** 上失败于同一个断言。另有一次 rc.3 运行在 `shared-reports` 场景因 30 秒等不到两个子 Agent 结算而超时，重跑即通过；该场景的子 Agent 包在 rc.2 与 rc.3 之间代码完全相同，属于既有 flake。

## 6. 边界与验证

- 真实模型调用为 0；未验证判断质量、自然任务收益、费用或耗时。
- 未重跑 7 个旧版本的矩阵；旧版本结论沿用 2026-10-21 报告。
- 未覆盖 GUI 全流程、其他平台或 Desktop / Hub 安装链路。
- 本轮不授权发布、不改动用户 profile、不调用真实付费服务。

