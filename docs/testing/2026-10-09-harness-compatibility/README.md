## 直接答案

插件已完成 DSH **0.2.1-alpha.2** 的本地适配及有界接入验证。原始插件基线 `a3de7fc` 被新版正式安装器拒绝，并自动恢复测试 profile；适配包经同一安装器正常安装，未使用版本豁免。最终 GitHub 安装入口使用的 82 个 runtime 文件与正式 Web profile 内的文件逐字节一致，Web 页面显示 9/9 组件运行、12/12 功能默认关闭。首次连接诊断时浏览器无 warning 或 error；为更新最终包而主动停止 Host 时出现 3 条连接重试 warning，重新加载后组件正常运行，未记录 console error。

The plugin was adapted and locally validated against published DSH **0.2.1-alpha.2**. The original package was rejected and rolled back by the official installer. The adapted package installed without an exemption; the final root-package runtime matched all 82 installed files. These are scoped compatibility results, not a general reliability or task-quality estimate.

本轮于上海时间 2026-10-09 开始，2026-10-10 完成。共保留 **18 个实验场景**，其中有一次已纠正的测试配置尝试。真实网络请求为 **40 次 DeepSeek Flash、28 次 Jev**，均收到 HTTP 200；其中 27 次 Jev 来自实验矩阵，1 次来自实际 Web 页面的“测试连接”。HTTP 成功、协议校验、判断采纳与实际文件结果分别核对，没有按 HTTP 200 计算任务成功率。

## 版本与改动

| 项目 | 本轮固定值 |
| --- | --- |
| Harness 来源 | [官方 0.2.1-alpha.2 release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-alpha.2)；源码 `d743267388641bc76f17c45ce8b4c231aed1d32c` |
| 实际运行 | npm 发布的 `@deepseek-ai/dsh@0.2.1-alpha.2`，通过正式 `dsh` profile 启动 |
| 插件原始基线 | `a3de7fc170ddac413f9e5d822dbe399346c215fd`，实际实验起点；提交历史见 Git 记录 |
| 依赖 | DSH `0.2.1-alpha.2`；Cordis `4.0.5-alpha.1`；Loader `1.0.6-alpha.1` |
| 本机环境 | macOS、Node `24.14.1`、pnpm `11.7.0` |
| 主模型 / 判断模型 | `deepseek-flash` / `jev-1.13.0`；没有跨提供方回退 |

依赖与 Typert 构建同步到精确发布版本，workspace 加入新版 Koffi 的构建许可。指令检查用公开 Cordis registry 中实际生效的 fibers 替代已删除的 preset lookup，并保留 runtime root 与 Agent 作用域筛选；实现见 [instructions.ts](../../../packages/jev/src/instructions.ts#L184)。新版 Session 可切换工作目录，因此技能选择和指令操作路径改用公开 WorkingDirectory 服务；见 [selection.ts](../../../packages/jev/src/selection.ts#L239) 和 [instructions.ts](../../../packages/jev/src/instructions.ts#L45)。

新版原生子代理先返回 activation，再向父 Agent 投递完成消息。回归测试改用该真实交付流程，验证同名子代理反序完成时仍对应实际 sender，以及既有纠正、取消、过期和跨 root 隔离。没有修改 Harness、Mu 或 Cua 源码。测试命令默认排除私有 `.artifacts/`，避免将实验项目与原始插件副本当成插件单元测试。

## 固定检查与正式安装

| 实际执行的检查 | 结果 |
| --- | --- |
| `pnpm install` / 最终 `pnpm install --frozen-lockfile` | 成功，使用已发布版本；最终 lockfile 可复用 |
| `pnpm run typecheck` | Host 与 Client 通过 |
| `pnpm run build` | 通过，重新生成并同步 tracked runtime |
| `pnpm run test --reporter=dot` | **27 个文件 / 338 个用例通过** |
| `pnpm peers check` | 插件 workspace 无 peer dependency 问题 |
| `git diff --check` | 通过 |
| 原始包 + 新版正式 installer | 拒绝旧 peers，恢复 profile；未设置版本豁免 |
| 新 nested 包 + 正式 headless / Web profile | 安装成功；47 个已安装 JS 与对应 built JS 一致 |
| 最终 root 包 + 正式 Web profile | 安装及重新加载成功；82 个 runtime JS / 声明文件逐字节一致 |
| 实际 Web 页面的连接诊断 | HTTP 200、返回 `jev-1.13.0`；Choice / Score / Noul 协议通过，377 input / 61 output tokens；无业务动作回执 |

固定集合包括共享服务、三种连接协议、选择、监督、指令、插话、共享纠正、日志、审批和阶段导航。两个新增回归先复现切换目录后的旧路径问题，再验证新目录中的技能目录、指令来源和实际写入路径。固定判断响应与 scripted 主模型验证接线和生命周期；它们不是提供方准确率测试。测试 stderr 仍有已有 React duplicate-key `111` 警告，本轮真实 Web console 未观察到该警告。

独立 profile 的 pnpm 安装及 `peers check` 报告 Host peers 不在该 profile 的物理依赖树中；插件开发 workspace 的 peer 检查通过。DSH 的 profile 明确关闭自动 peer 安装，并在进程中由运行时包表解析这些依赖，见固定源码的 [profile.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/boot/app-boot/src/profile.ts#L251) 与 [app-boot 运行时解析说明](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/boot/app-boot/README.md#L136)。本轮另用正式启动、9 个组件的真实状态和模型任务检查实际解析，未把 pnpm 的独立静态检查替代运行验证。

## 实际实验与未达预期结果

参数保持原值：技能 top 5、文件候选最多 40 / 展示 12、通用日志至少 6,000 字符、测试日志至少 4,000、日志等待 4,000 ms、省略概率门槛 0.8。只显式开启各场景对应功能。场景及命令见 [results.json](results.json)，统一答案、动作回执和独立文件核对见 [receipts.json](receipts.json)。

| 场景 | 真实执行结果 | 适用边界 |
| --- | --- | --- |
| 默认关闭与配置尝试 | 真实 Flash 返回预定 marker；一次真实 Jev 三题诊断通过 | 首次 overlay / observer 配置有警告，保留为 setup attempt；diagnostic 不代表开启业务功能 |
| `glob` 的 12 / 0 / 41 个路径 | 12 个候选由真实 Jev 判断，存在 `glob-paths-ranked` 收据，Flash 实际读到目标文件 marker；0 与 41 路径没有判断请求 | 有界实际文件项目；没有把同分排序解释成准确率提升 |
| 8 个技能 | 真实 Jev 发布 top 5；真实 Flash 用原生 `skill` 加载原始正文并报告 marker | 名称与摘要排序，不改技能内容 |
| 通用日志 | 实际命令输出 **7,634 → 853 字符，减少 88.83%**；原始 450 行输出可恢复，恢复内容 SHA-256 已核对 | 单份受控长日志，不代表自然日志的平均压缩率或 token 成本收益 |
| 三种测试日志任务 | 原生 Node 测试 101/101 通过；点名与普通 reporter 场景没有进入判断；中性 TAP 场景执行两次测试、获得两次真实 Jev 判断，原文保留 | 没有最终缩减收据；保留主模型额外重跑一次测试的事实，不声明测试日志缩减成功 |
| 固定初始遗漏的完成诊断 | scripted 初始回答漏掉 checksum；真实 Jev 请求补充一次，真实 Flash 执行后 `summary.txt=ready\n`、`checksum.txt=checked\n`，有 supplement-delivered 收据 | 初始错误固定，补充是真实模型；只有一个错误样例，不能计算自然任务修复率 |
| 准确完成对照 | scripted 已完成结果被真实 Jev 判断为 complete，无补充、无真实主模型请求 | 是机制对照，不是另一个双真实任务 |
| 指令与实际目录 | 原始 AGENTS 进入真实 Jev 无冲突检查；切换目录后读取新 guide，写入新目录的 `report.txt`，根目录没有同名文件 | 此轮没有新增真实违规提醒正例；两次后台检查在轮次结束时取消，即使 HTTP 已返回也未采纳 |
| 子目录与独立子项目技能 | 同一项目的子目录没有自动成为新技能根，原生 `skill` 返回 unknown，Flash 回读原始 SKILL 文件；独立子项目场景用 3 次 Flash、2 次 Jev 请求完成 native cd → 原生子项目 skill → 正确 marker | 两种结果都保留；项目根发现由 Harness filesystem provider 负责，插件未增加扫描或覆盖其语义 |
| 单次工作区审批 | 相对路径的合并 write/read 样例被 Jev 判 unauthorized，转回原生人工路径后由无人值守 observer 取消，CLI exit 1、文件不存在；另一绝对路径单次写样例获 approve → native allowed-once → 执行收据，实际文件恰为 `EXACT_APPROVAL_OK` | 一个拒绝与一个批准，不能建立审批可靠性；Session sandbox mode 没有改变 |
| 冷历史阶段导航 | 正式 Web profile 对新真实 Session 的三个完整步骤发出 3 次 Jev 请求；阶段为 implementation、implementation、delivery_finalization；再次 missing 分析没有新增请求 | 读取本身零判断请求；仅证明显式分析与结果复用，不证明标签语义准确率；无额外主模型请求 |

早期场景使用第一版兼容包，切换目录场景使用修正 WorkingDirectory 的最终包。每个场景保留 `artifactPhase`，各安装包保留 SHA-256，未把旧实验的运行二进制改写成最终包。最终包另做正式安装、逐文件核对及 Web 重新加载，不为文档更新重复付费场景。

## 复核与重跑

先运行上面的固定检查，再按 [results.json](results.json) 中的 `command` 单独执行场景。入口为 [latest-harness-run.mjs](../../../scripts/validation/latest-harness-run.mjs)，观察与数据整理分别由同目录中的 observer、fetch 和 report 脚本完成。阶段导航另通过正式 Web profile 运行。下面的准备步骤不调用模型；使用新的实验目录，保留已有结果。

```sh
pnpm install --frozen-lockfile
pnpm run build
mkdir -p dist
pnpm -C packages/jev pack --pack-destination "$PWD/dist"
npm install --prefix .artifacts/harness-runtime --no-audit --no-fund @deepseek-ai/dsh@0.2.1-alpha.2
export JEV_VALIDATION_ARTIFACTS_DIR="$PWD/.artifacts/harness-validation-rerun"
node scripts/validation/latest-harness-prepare.mjs
DSH_HOME="$JEV_VALIDATION_ARTIFACTS_DIR/home" DSH_AGENTS_HOME="$JEV_VALIDATION_ARTIFACTS_DIR/agents" \
  .artifacts/harness-runtime/node_modules/.bin/dsh --profile compatibility-headless \
  --from-default-profile headless --dump-default-config > "$JEV_VALIDATION_ARTIFACTS_DIR/profile.yml"
DSH_HOME="$JEV_VALIDATION_ARTIFACTS_DIR/home" DSH_AGENTS_HOME="$JEV_VALIDATION_ARTIFACTS_DIR/agents" \
  .artifacts/harness-runtime/node_modules/.bin/dsh plugin --profile compatibility-headless \
  add "$PWD/dist/dsh-jev-plugin-0.1.0.tgz"
```

准备后，单独运行 `node scripts/validation/latest-harness-run.mjs file-ranking` 会调用真实 Flash 和 Jev；其他已执行场景名和命令保留在 JSON 中。脚本拒绝覆盖已有场景证据，普通 `pnpm run test` 不会调用这些服务。离线 fixture preparer 产生的 72 个文件已与本轮实际使用的原始夹具逐字节对照；未把重生成夹具当作另一轮真实实验。

实际模型场景会消费配置服务的额度。凭据由 Harness 原生 credential provider 读取，只在本机使用；可用 `JEV_VALIDATION_CREDENTIAL_FILE` 指定已有凭据文件。脚本不提供密钥，不更改已有用户 profile。此轮限制为最多 40 次主模型请求，独立子项目补验额外限制为最多 3 次；本轮已停止付费调用。原始 Session、HTTP body、profile、认证访问地址和原文恢复材料保留在 gitignored `.artifacts/`。

## 边界与验证

本轮仅实测 Jev；Luna / OpenAI、Luna / OpenRouter 的新版兼容证据来自确定性协议和集成测试，本轮没有对应真实 API 请求。跑偏提醒、目标监督、插话分流、共享发现纠正没有新增真实服务场景；其结论限于本轮通过的固定生命周期测试。没有验证 Windows、Linux、Desktop 载体、自然任务大样本准确率、长期稳定性、概率校准或费用账单。

40 次主模型 HTTP 收据中 38 次捕获到返回模型，2 次默认关闭场景没有完整流式元数据；旁路 observer 在原生 adapter 关闭 SSE clone 时记录 AbortError。HTTP 状态、可捕获的模型字段、Session 完成及文件结果分开保存。27 次矩阵 Jev 和 1 次 Web 诊断均确认返回 `jev-1.13.0`；其中两次后台指令判断因轮次结束而未采用。18 个场景不是成功率分母。公开 JSON 经过精简与脱敏；原始请求、响应和 Session 未公开。历史 Luna 结果保持在[原报告](../2026-10-07-luna-decisions/README.md)，不合并成这次新版实测结论。
