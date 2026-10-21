## 直接答案

本次将插件的精确开发基线从 DSH `0.2.1-alpha.2` 升至 `0.2.1-rc.2`。保留原有六个精确发布版本的支持，并为 `0.2.1-rc.2` 增加独立声明。开发版本和允许安装的版本分别维护，不使用无上界范围声明未来兼容。同一份最终正式根包已在这七个发布版本上通过官方安装、九个 Host 组件激活与 Web 接入检查，真实模型调用为 0。公开[结构化结果](results.json)保留本次检查的版本、场景与结果。

## 版本与安装

2026-10-21 核对 npm 发布元数据时，`@deepseek-ai/dsh` 的 `latest` 与 `next` 均指向 `0.2.1-rc.2`；本次检查使用精确版本。官方 tag 为 `dsh-v0.2.1-rc.2`，对应 DSH 源码为 [`687f282e8625c6b8d11ff58211a90524be2e4317`](https://github.com/deepseek-ai/deepseek-harness/commit/687f282e8625c6b8d11ff58211a90524be2e4317)。本次适配基于插件 `main` 的 `0f3555445c432152cd4091ab75dc62c2052f5dae`，包含已合入的插话历史预算修复。

安装方式见[中文安装说明](../../../README.zh-CN.md#网页端安装推荐)。本次声明的版本为 `0.1.7-rc.1`、`0.1.7-rc.2`、`0.2.0-rc.1`、`0.2.0-rc.2`、`0.2.1-alpha.2`、`0.2.1-alpha.3` 和 `0.2.1-rc.2`；`0.2.1-alpha.1`、其他 RC 及后续正式版不在声明内。

本轮执行环境为 macOS、Node.js `24.14.1` 与 pnpm `11.7.0`。其他平台须分别运行相同检查，不从本机结果推定。

## 必要适配

构建使用 rc.2 官方 Typert 生成器，并等待异步 `writeBundle` 完成。新生成的 Host 与 Remote 入口需要官方 `remote-info` helper；旧 DSH 没有该运行子路径，因此正式包随带官方无运行依赖的 helper，并让生成入口引用本地文件。对应 MIT 声明见[根安装包通知](../../../THIRD_PARTY_NOTICES.md)与[workspace 包通知](../../../packages/jev/THIRD_PARTY_NOTICES.md)。构建还固定 Zod `4.4.3`，与 rc.2 `storage-domain` 使用的版本一致，避免不同版本声明导致类型不兼容。

[根构建命令](../../../package.json#L258)的 Host 编译使用 `tsc -b tsconfig.host.json --force`，每次从完整类型图重新生成声明，使保留编译缓存的工作区与干净 CI 构建生成一致的声明。

rc.2 的原生 PTC `run_code` 将派发取消和 sandbox 取消组合为新的审批请求 signal；原来的严格 signal 对象比较因此漏过该原生请求。本次仅允许 `run_code` 使用派生 signal，其他支持工具仍要求同一 signal。匹配继续要求精确 Agent、call、tool、原生提权参数与 reason、唯一活跃派发及唯一匹配的原生审批记录；Jev 判断、最终采用检查和准备转交阶段同时监听派发、请求及消费者生命周期的取消。调用原生 `next()` 转交人工后，由原生请求 signal 负责取消；卸载 Jev 不取消已经交给人工的请求。公开 API 不提供 signal 祖先查询，本次通过上述派发和审批记录关联请求。该适配不增加工具种类或长期许可。

实现见[生成入口](../../../scripts/generate-typert.mjs#L6)、[官方 helper 打包](../../../scripts/generated-remote-runtime.mjs#L12)与[工作区审批](../../../packages/jev/src/workspace-approval.ts#L59)。

## 开发依赖与旧版运行

rc.2 新生成的 Remote 声明引用 `TypertRemoteInfo` 与 `TypertRemoteMethod`；旧 DSH 没有这些导出。本次保留新生成的完整类型，不把它们裁剪成旧声明。旧六版本的支持针对正式安装包的安装与运行；从源码构建，以及直接消费新 Remote 声明的 TypeScript 项目，必须使用 rc.2 开发依赖。七版本安装与运行检查不等于旧 SDK 类型编译兼容。

## 本轮验证

| 已执行检查 | 结果与范围 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 通过 |
| `pnpm run typecheck` | 通过；Host 与 Client 使用 rc.2 开发依赖 |
| `pnpm test` | 31 个文件、420 个用例通过 |
| `pnpm run build` | 连续两次常规构建通过；85 个 tracked runtime 文件的逐文件 SHA-256 一致；49 个 JavaScript 文件相对该构建修复前全部不变 |
| 最终正式根包一致性 | tarball manifest 与根清单完全一致；87 个 runtime、声明和 Cordis patch 文件逐字节相同；全部 95 个打包文件均已比对一致 |
| 工作区审批定向回归 | 28/28 通过，包含原生 `run_code` 派生 signal 和 policy-change 取消 |
| 阶段导航集成回归 | 7/7 通过 |
| `node website/build.mjs` | 通过；生成 1 个首页、4 个原理文章页、1 个判断连接页、11 个功能页和 10 个公开证据页，共 27 页 |
| 网站链接与浏览器检查 | 345 条站内链接中，断链及失效 fragment 为 0；浏览器 `pageerror` 为 0 |
| 网站桌面与手机布局 | 1440 和 390 像素宽度下，页面 `scrollWidth` 分别为 1440 和 390；截图已目检，未发现横向溢出 |
| 网站入口语法 | `node --check website/build.mjs` 与 `node --check website/src/features.mjs` 通过 |

本轮用于正式兼容检查的同一根包 SHA-256 为 `6599f20b14ea8a88d07570b06f5240e3c3a6c49b1ee601223c6f7afb5c768f34`。

## 七个发布版本的正式包检查

本次矩阵使用上面同一份 tarball 和正式 manifest，`experimentalManifest` 为 `false`，命令退出码为 0。

| DSH 发布版本 | 官方安装 | Host 组件 | Web 设置与记录 | 固定场景 |
| --- | --- | --- | --- | --- |
| `0.1.7-rc.1` | exit 0 | 9/9 ACTIVE | 通过 | 5 个 |
| `0.1.7-rc.2` | exit 0 | 9/9 ACTIVE | 通过 | 5 个 |
| `0.2.0-rc.1` | exit 0 | 9/9 ACTIVE | 通过 | 5 个 |
| `0.2.0-rc.2` | exit 0 | 9/9 ACTIVE | 通过 | 5 个 |
| `0.2.1-alpha.2` | exit 0 | 9/9 ACTIVE | 通过 | 6 个 |
| `0.2.1-alpha.3` | exit 0 | 9/9 ACTIVE | 通过 | 6 个 |
| `0.2.1-rc.2` | exit 0 | 9/9 ACTIVE | 通过 | 6 个 |

七个版本的实际 Web 页面均显示 12 个功能开关和判断记录，`pageErrors`、`consoleErrors` 与 `importErrors` 均为 0。共同场景为 `session-a`、`session-b`、`native-goal`、`shared-reports` 和 `skill-no-relevant`；alpha.2、alpha.3 与 rc.2 另运行 `native-cwd-switch`。旧四版本不具备原生实时目录服务，因此不运行该场景。固定场景验证原生接线与结果消费，不构成模型语义准确率。

## 复跑入口

从插件源码重新构建正式根安装包，并准备精确发布版 CLI 的入口为：

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
pnpm run test:compatibility --version 0.2.1-rc.2
node website/build.mjs
```

[兼容性 smoke 指南](../compatibility-smoke/README.md)说明 Chromium 准备、产物目录和失败判定。其他已声明版本可通过 `--version` 分别运行；每次使用新的实验目录。上面的命令是复跑方法；实际已执行结果以本报告的检查表为准。

## 边界与验证

本轮只使用可丢弃 profile、本地主模型 adapter 和回环判断服务。真实 DeepSeek、Jev、Luna 或其他付费模型调用数为 **0**。安装、Host 激活、Web 页面和固定回复的集成检查不证明判断模型质量、自然任务收益、平均费用或未运行平台的兼容性。七版本正式包矩阵在 macOS 上执行；Linux / Windows CI 的独立检查范围与结果见 [PR #44 checks](https://github.com/luobosibing2/dsh-jev-plugin/pull/44/checks)。这些 CI 检查不代表 Windows 完整安装、Desktop 或 Hub 安装链路已通过。

[2026-10-11 旧版本矩阵](../2026-10-11-harness-version-compatibility/README.md)和[2026-10-09–10 真实模型报告](../2026-10-09-harness-compatibility/README.md)保留当时的源码、版本与实验条件；本次不重写其中的历史结果。公开网站只镜像本报告，不读取原始 Session、临时认证地址、用户凭据或本机实验路径。
