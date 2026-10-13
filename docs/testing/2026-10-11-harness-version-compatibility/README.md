## 直接答案

当前插件已补上旧宿主的目录兼容处理，并在 npm 发布的 DSH **0.1.7-rc.1、0.1.7-rc.2、0.2.0-rc.1、0.2.0-rc.2 和 0.2.1-alpha.2** 上完成本地接入矩阵。正式根包与 workspace 包均在五个版本上通过官方安装器安装并激活九个 Host 组件，共十次最终包安装。每次安装的 82 个 runtime / lib 文件与对应源产物逐字节一致，补丁、peer 声明与打包 README 也已核对。两个旧版目录消费者可以使用所属 Session 的目录；alpha.2 继续使用原生 WorkingDirectory，并跟随原生目录切换。

The plugin now supports the five published DSH versions listed above. Both final packages passed official installation on all five versions, with no version exemption. All nine Host components activated, all thirteen Host exports imported, and each installation matched its 82 generated files. Deterministic local cases exercised native tools and Jev integration. Legacy hosts use their own Session directory; alpha.2 retains the native live-directory service. These results cover integration in the tested environment, not model judgment quality.

支持声明在行为矩阵和浏览器检查通过后扩大为 `>=0.1.7-rc.1 <=0.2.0-rc.2 || 0.2.1-alpha.2`。开发依赖继续固定 `0.2.1-alpha.2`；本次未把 alpha.1 或未来版本加入声明。公开汇总见 [results.json](results.json)，原始 profile、Session 和 HTTP 请求保留在本地忽略目录中。

2026-10-11 12:17:38 UTC 查询 [npm 公共发布元数据](https://registry.npmjs.org/@deepseek-ai%2fdsh)，并按宿主的 `includePrerelease: true` 规则过滤全部 31 个发布版本，旧版区间恰好命中表中的四个 RC；该区间内没有遗漏其他已发布版本。区间支持有明确上界，alpha.2 作为独立精确版本加入。

## 问题与修复

[Issue 19](https://github.com/luobosibing2/dsh-jev-plugin/issues/19) 的用户报告 DSH `0.2.0-rc.2` 无法安装。DSH 官方安装器按插件声明的 peers 检查运行时版本；插件原先精确声明 `0.2.1-alpha.2`，因此旧版本无法通过检查。该机制支持版本区间，并不要求所有插件声明精确版本。

只放宽声明仍不足以解决问题：安装后的技能选择与指令检查必需注入旧版本没有的 WorkingDirectory 服务，导致九个 Host 组件中只有七个激活。本轮保留这个失败样例，并补上兼容代码后再执行完整矩阵。

技能目录在每次操作时检查当前生效的目录服务：存在时调用原生 `ensure()`，缺少时传递 `session.header.cwd`；旧 Session 未设置目录时保留 `undefined`，让原生技能 provider 使用其已有默认值。指令操作证据同样优先使用原生 `get()`，旧宿主使用 `session.header.cwd ?? process.cwd()`。两者都按所属 Agent 或 Session 获取目录，不缓存“服务不存在”的状态。服务读取失败或取消时保持原有失败处理，不以旧目录继续生成判断证据。实现见 [selection.ts](../../../packages/jev/src/selection.ts#L61) 与 [instructions.ts](../../../packages/jev/src/instructions.ts#L45)。

Each operation checks for an active WorkingDirectory service. If it exists, the plugin uses its native directory and error handling. If it is absent, the plugin uses the same Session directory as the legacy native tools. An unset legacy skill directory remains undefined so that the provider selects its existing default. The compatibility path adds no user setting or new tool.

根安装包与 workspace 包使用相同的 34 个 DSH peer 声明，并把 WorkingDirectory peer 标为可选。Cordis 声明为 `4.0.4 || 4.0.5-alpha.1`，Loader 为 `1.0.5 || 1.0.6-alpha.1`，覆盖本轮宿主实际使用的版本。运行依赖与精确开发依赖保持原值；GitHub 安装入口使用的 tracked runtime 与源码一起更新。

## 本轮验证

实验使用独立 profile、目录和凭据文件，在 macOS 上通过各版本发布的 `dsh` CLI 启动标准 Web profile。主模型为本地确定性 adapter，Jev 为仅监听回环地址的确定性 HTTP 服务；真实付费模型调用数为 **0**。fixture 拒绝外部模型路由，并核对它与官方 LLM provider 使用同一运行时实例。十二项功能在实验 profile 中显式开启，产品默认值仍为关闭。

| DSH 发布版本 | 正式根包 / workspace 官方安装 | Host 组件 | 两个 Session 的技能、指令与原生读取 | 原生实时目录切换 |
| --- | --- | --- | --- | --- |
| 0.1.7-rc.1 | 两种包均通过 | 各 9/9 激活 | 通过 | 该宿主没有此服务 |
| 0.1.7-rc.2 | 两种包均通过 | 各 9/9 激活 | 通过 | 该宿主没有此服务 |
| 0.2.0-rc.1 | 两种包均通过 | 各 9/9 激活 | 通过 | 该宿主没有此服务 |
| 0.2.0-rc.2 | 两种包均通过 | 各 9/9 激活 | 通过 | 该宿主没有此服务 |
| 0.2.1-alpha.2 | 两种包均通过 | 各 9/9 激活 | 通过 | 切换至 B 后读取、技能和指令证据均使用 B |

| 实际执行的检查 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 通过 |
| `pnpm run typecheck` | Host 与 Client 通过 |
| `pnpm run build` | 通过，更新 tracked runtime |
| `pnpm test` | 27 个文件、346 个用例通过 |
| 技能选择与指令检查的定向回归 | 39 个用例通过；新增旧服务缺失、Session 隔离、默认目录、服务晚于消费者激活、服务错误和取消用例 |
| 最终两包的五版本矩阵 | 共十次 version / profile 初始化 / 官方安装均 exit 0；业务 fixture 全部通过，各 9/9 Host 激活、13 个 Host exports 实际导入成功 |
| 最终安装文件一致性 | 十份安装各 82/82 文件相同，补丁与 peers 相同；根包三份 README 和 workspace 一份 README 均与当前文件相同 |
| 正式 manifest 的官方兼容检查 | 两份清单各接受五个目标版本；各拒绝九个边界样例，包含低于起点、`0.2.0-rc.3`、`0.2.0`、`0.2.1-alpha.1`、`0.2.1-alpha.3`、`0.2.1` 和 `0.2.2`，没有版本豁免；排除检查调用 rc.2 的公开 checker 并指定 runtimeVersion，不是启动每个未支持宿主 |
| 浏览器检查 | 最早版本、`0.2.0-rc.2` 与 alpha.2 的实际 Web 页面显示 12 个功能开关、9 个运行组件和成功判断记录；每组 console error / warning 均为 0 |
| 三个新增验证入口的 `node --check` 与 `git diff --check` | 通过 |
| 矩阵入口的三个失败出口 | 明确标记的假 CLI 分别令 version / profile 初始化 / install 失败，入口均返回 exit 1 且未启动 Host；这是脚本负控，不计入插件版本矩阵 |

两项新增旧目录回归先在修改前复现失败，再在修改后通过。矩阵先用修改后 runtime 和实验安装声明验证行为；正式支持区间在该阶段通过后才更新，随后两种最终包均重跑五版本矩阵。浏览器检查使用独立 Chrome contexts，只读取实验设置和判断记录；其页面使用同一 runtime 的前置矩阵包，最终包另做逐字节核对。停止实验 Host 是主动清理，不把收到 SIGINT 后的 exit 130 解释成启动失败。最终进程核对没有残留本轮矩阵、Host 或本地判断服务，临时认证访问地址已脱敏。

## 功能证据与适用范围

五版本矩阵分别完成 Choice、Score、Noul 协议诊断，取得技能选择、文件排序、指令检查、完成检查、跑偏检查、目标监督、插话分流、共享发现、两种日志处理、工作区审批的判断记录，并完成阶段导航。除“判断记录存在”之外，本轮另检查了以下实际消费结果。

| 功能路径 | 观察到的消费结果 | 覆盖限制 |
| --- | --- | --- |
| 技能、文件和指令 | A / B 两个 Session 的候选、指令来源和原生 `read` 内容分别对应自己的项目；实际 Session 消息中的指令提醒进入本地主模型输入 | 部分判断因同一要求已提醒过，或指令 / 活跃轮次变化而未采纳；不把全部成功判断视为全部采纳，也不把提醒投递视为模型已遵守 |
| alpha.2 目录切换 | 原生 `working_directory` 切至 B 后，原生读取、技能候选和指令 operation.cwd 使用 B | 旧版本没有该工具，本轮不为旧宿主新增目录切换 |
| 通用日志与测试日志 | 原生脚本运行成功；两类工具消息均出现确定性省略结果 | 本地固定日志与固定回复，不评估自然日志质量或平均缩减率 |
| 目标、完成与跑偏 | 原生目标完成 gate 与对应判断记录运行完成；普通案例获得完成和 on-track 记录 | 不覆盖持续无进展暂停或所有补充、重试与失败组合 |
| 插话与共享发现 | 运行中纠正获得实际 delivered 回执；两个原生前台子代理报告进入关系判断 | 不覆盖所有纠正接收者或冷恢复路径 |
| 单次工作区审批 | 获得 native grant-issued 与 tool-result 回执；实验目录外的授权文件实际内容为 `COMPAT_APPROVAL_OK` | 仅限明确授权的单次实验写入，不评估判断模型的授权可靠性 |
| 阶段导航 | 对第一个实验 Session 的九个步骤完成分类，无失败或取消 | 不评估阶段标签语义准确率 |

The local adapter and HTTP replies are fixed inputs. The matrix checks native execution, protocol handling, Session isolation, selected adoption paths and file results. It does not measure natural-task accuracy, reliability improvement or model calibration. The fixture uses a drift interval of one and a larger supervision evidence budget to keep its bounded logs available for these checks.

## 复核与重跑

自动准备正式包和 CLI 的入口见[兼容性 smoke 指南](../compatibility-smoke/README.md)。手动复核本矩阵时，入口为 [compatibility-matrix.mjs](../../../scripts/validation/compatibility-matrix.mjs)，测试 profile 为 [compatibility-profile.mjs](../../../packages/jev/tests/fixtures/compatibility-profile.mjs)。准备五个明确版本的已发布 CLI，并按各版本 `@deepseek-ai/dsh/package.json` 的 `bin.dsh` 获取入口绝对路径，写入以精确版本号为键的 JSON。安装包可由根目录 `npm pack --ignore-scripts` 或 workspace 的 `pnpm pack` 生成。

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run build
pnpm test
node scripts/validation/compatibility-matrix.mjs \
  --runtime-map <five-published-cli-paths.json> \
  --artifacts .artifacts/compatibility-rerun \
  --final-package <packed-plugin.tgz>
node scripts/validation/compatibility-report.mjs \
  --matrix .artifacts/compatibility-rerun/results.json \
  --output .artifacts/compatibility-rerun/summary.json
```

尖括号参数需要替换为本机准备的文件路径。每次使用新的实验目录；脚本拒绝覆盖已有场景证据，不读取真实用户 profile。`--final-package` 使用所给包的实际声明与文件；未提供时只在本地实验副本中生成临时声明，不修改正式 manifest。原始汇总仍含本机路径与实验 Session 标识，公开前须另行精简；本报告的 JSON 只保留验证事实和源码哈希。

## 边界与验证

本轮验证 macOS 上发布 CLI 的官方安装与标准 Web profile；没有验证 Issue 19 用户的 Windows 环境、Desktop 载体或 Hub 安装链路。原 Issue 的简短错误不能单独证明安装器、Hub 或某个具体命令的根因。本轮确实修复了当前包的旧版 peer 声明与两个组件的可达兼容问题，仍需发布后由原用户确认其实际环境。

This run did not test Windows, Linux, the Desktop carrier or Hub. All model responses were local fixtures. Successful installation and deterministic integration do not establish semantic judgment quality, long-term stability or compatibility with untested releases. The prior [real-model compatibility report](../2026-10-09-harness-compatibility/README.md) retains its own alpha.2 scope and is not evidence of real-model calls on every version in this matrix.
