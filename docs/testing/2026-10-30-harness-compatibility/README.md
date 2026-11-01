## 直接答案

本次将插件的精确开发基线从 DSH `0.2.1-rc.2` 升至 `0.2.1-rc.5`，并为 `rc.5` 增加独立的安装支持声明。同一份正式根包已在 `rc.5` 与保留的七个旧发布版本上，通过官方安装、九个 Host 组件激活、固定场景和真实 Web 检查；八个版本的 Web 检查均包含 Jev 设置、判断记录、测试会话的阶段导航及返回聊天。本轮使用本地固定主模型与回环判断服务，真实模型调用为 **0**。[结构化结果](results.json)记录本次已完成的验证。

## 版本与运行对象

2026-10-30 核对 [npm 发布元数据](https://www.npmjs.com/package/@deepseek-ai/dsh?activeTab=versions)时，`@deepseek-ai/dsh` 的 `latest` 与 `next` 均指向 `0.2.1-rc.5`。本次使用该精确发布版本，官方标签 `dsh-v0.2.1-rc.5` 指向 [`b830ec950faba0a46dda564be3e2d854afed94f1`](https://github.com/deepseek-ai/deepseek-harness/commit/b830ec950faba0a46dda564be3e2d854afed94f1)。预览标签 `alpha` 指向的 `0.2.2-alpha.2` 不在本次验证范围内。

插件基线为 `main` 的 [`691720993291a0949caf11444bfd60df53ebe351`](https://github.com/luobosibing2/deepseek-harness-jev/commit/691720993291a0949caf11444bfd60df53ebe351)。本轮环境为 macOS、Node.js `24.14.1`、pnpm `11.7.0` 和 Playwright Chromium `156.0.8078.4`。正式包沿用根安装入口 `@dsh-jev/plugin@0.1.0`。

安装与支持版本见[中文安装说明](../../../README.zh-CN.md#网页端安装推荐)。开发依赖、允许安装的版本和实际验证版本分别记录；本次仅为已检查的 `rc.5` 增加精确声明，不以开放范围承诺未来版本兼容。

## 本次更新

根包和 workspace 包的 DSH 开发依赖固定为 `0.2.1-rc.5`，两份 peer 声明增加该精确版本，兼容检查列表与 Typert 协议同步脚本使用同一版本。pnpm 发布年龄例外保留原有精确版本，并为本轮锁文件中的 `rc.5` 包添加精确版本；同名规则合并，避免前一条规则遮蔽后一条。

本轮没有修改 Jev 业务源码。正式构建重建了受跟踪的 `runtime/`，其 87 个文件与基线逐字节相同。[兼容夹具](../../../packages/jev/tests/fixtures/compatibility-profile.mjs#L201)将被分类的测试会话关联到临时 workspace，使真实 Web 侧栏可以进入该会话。[浏览器检查](../../../scripts/validation/compatibility-browser.mjs#L117)随后打开阶段导航、核对已分类步骤，并返回聊天正文；这补充了只读取 Host 阶段数据时无法覆盖的客户端接入检查。

## 本轮已执行检查

| 检查 | 实际结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 通过 |
| `pnpm run typecheck` | 通过；Host 与 Client 使用 `rc.5` 开发依赖 |
| `pnpm test` | 31 个文件、458 个用例通过 |
| `pnpm run test:compatibility --version <精确版本>` | 八个声明版本分别通过；每次重建正式包并检查官方安装、Host 与 Web |
| 正式包与 runtime 一致性 | 八个版本的最终包 SHA-256 相同；每次 89 个检查文件逐字节相同；87 个受跟踪 runtime 文件重建后与基线相同 |
| `node --check website/build.mjs` 与 `node --check website/src/features.mjs` | 通过 |
| `node website/build.mjs` | 通过；生成 1 个首页、4 个原理文章页、1 个判断连接页、11 个功能页和 11 个公开证据页，共 28 页 |
| 生成网站的站内链接检查 | 355 条站内链接中，断链及失效 fragment 为 0 |

## 八个发布版本的正式包检查

每次正式 smoke 都从本次工作区构建并打包根安装入口，准备精确版本的官方 DSH CLI，再通过官方 `dsh plugin add` 安装到可丢弃 profile。八个版本的最终检查均得到同一份 tarball，SHA-256 为 `71a44df8a706a16c8fe4853090761bc7dfe3a8426bd9b94b0b238ca53294cc2f`。每次 tarball 的 manifest、声明入口、Cordis patch 与 runtime 均与工作区对应文件比对；89 个检查文件全部逐字节相同，`experimentalManifest` 为 `false`。

| DSH 发布版本 | 官方安装 | Host 组件 | Web 设置与记录 | 阶段导航与返回聊天 | 固定场景数 |
| --- | --- | --- | --- | --- | --- |
| `0.1.7-rc.1` | exit 0 | 9/9 ACTIVE | 通过 | 通过 | 5 |
| `0.1.7-rc.2` | exit 0 | 9/9 ACTIVE | 通过 | 通过 | 5 |
| `0.2.0-rc.1` | exit 0 | 9/9 ACTIVE | 通过 | 通过 | 5 |
| `0.2.0-rc.2` | exit 0 | 9/9 ACTIVE | 通过 | 通过 | 5 |
| `0.2.1-alpha.2` | exit 0 | 9/9 ACTIVE | 通过 | 通过 | 6 |
| `0.2.1-alpha.3` | exit 0 | 9/9 ACTIVE | 通过 | 通过 | 6 |
| `0.2.1-rc.2` | exit 0 | 9/9 ACTIVE | 通过 | 通过 | 6 |
| `0.2.1-rc.5` | exit 0 | 9/9 ACTIVE | 通过 | 通过 | 6 |

共同固定场景为 `session-a`、`session-b`、`native-goal`、`shared-reports` 和 `skill-no-relevant`。`alpha.2`、`alpha.3`、`rc.2` 与 `rc.5` 另运行 `native-cwd-switch`；前四个旧版本的测试 profile 未提供 `workingDirectory` 服务，因此未运行这一场景。八个版本的设置页均显示 12 个按夹具启用的功能开关，记录页可见；阶段导航显示该测试会话的 10 个已分类步骤，返回聊天后可见夹具最终回复。每个版本均为 `pageErrors=0`、`consoleErrors=0`、`importErrors=0`，真实模型调用为 0。

九个组件激活是 Loader 状态检查；固定场景另外核对技能选择、文件排序、指令提示、完成核查、日志省略、共享发现和阶段分类等结果。场景名称或工具执行本身不证明每个监督、插话和审批分支都得到成功采用，也不构成判断准确率。

## 复跑入口

从源码准备依赖、构建正式包并执行精确版本检查：

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
pnpm run test:compatibility --version 0.2.1-rc.5
node website/build.mjs
```

[兼容性 smoke 指南](../compatibility-smoke/README.md)说明 Chromium 准备、可丢弃目录、支持版本选择和失败判定。保留的旧版本须分别用 `--version` 执行相同检查；复跑方法不代替本报告记录的实际结果。

## 边界与验证

本次检查使用临时 DSH home、Agent home、workspace 和夹具凭据，没有调用真实主模型或判断服务，也没有读取或修改真实用户 profile。通过结果支持八个精确版本在所测 macOS 环境中的正式包安装、Host 接入与已检查的 Web 页面；不证明全部 12 项功能的真实业务效果、自然任务判断质量、总 token 或成本收益，也不推定其他平台、Desktop 或 Hub 安装流程通过。

旧版支持针对正式包的安装与运行；源码构建和直接消费生成 Remote 声明的 TypeScript 项目使用 `rc.5` 开发依赖，不从旧版运行检查推定旧 SDK 的类型编译兼容。

[2026-10-21 报告](../2026-10-21-harness-compatibility/README.md)保留 `rc.2` 的七版本确定性矩阵及 13 次真实服务请求。那些真实模型结果仍属于当时的源码、版本和任务条件，不作为本次 `rc.5` 的真实模型证据。公开报告和网站只包含脱敏摘要，不镜像原始 Session、临时认证地址、凭据或本机实验路径。
