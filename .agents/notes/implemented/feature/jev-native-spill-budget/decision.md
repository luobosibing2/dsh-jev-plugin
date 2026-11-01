# Jev 在原生 Spill 预算内进行日志准入

状态：implemented。[PR #48](https://github.com/luobosibing2/dsh-jev-plugin/pull/48) 于 2026-10-24 23:37（Asia/Shanghai）合并到 `main`，合并提交为 `49d0994d8454162138ad8b13aa4cc235e76143f3`。最终 [Delta Spec](delta-spec.md) 负责本次行为与验收，本文记录已交付决策、取舍及实际验证。

## Problem

Jev 的日志准入位于原生 Spill 裁剪之前。对超过原生预算的结果先做判断和省略，会增加辅助请求，并可能让 Jev 与 Spill 分别保存不同版本的日志。原生预算内的相关性去噪与超预算裁剪需要采用同一计价依据。

## Decision

存在有限原生预算时，Jev 先用宿主共享估算检查完整模型可见结果。超过预算直接交给原生 Spill，不发起判断或规则省略；等于预算继续接受现有适用检查。已知策略未加载或未配置预算时保留既有 Jev 处理，`0` 仍是有限预算。

预算来自公开 Cordis 运行实例和验证后配置，按本次工具事件的公开过滤规则确定可见性，并检查执行期间的连续稳定性。多份可见有限预算、无法可靠确定身份或预算、策略及 Loader 上下文变化均放弃本次 Jev 处理或替换。共享内容估算直接复用宿主导出，不复制基础 profile 数字或按相同数值的码点数替代。

采用前，完整替换文本中的省略标记、实际恢复 locator 与提示、外层结果一并计入预算。完整请求、候选及保留证据、超时、取消、任务版本、原文保存和净缩减约束保持有效。

实现见 [预算检查](https://github.com/luobosibing2/dsh-jev-plugin/blob/49d0994d8454162138ad8b13aa4cc235e76143f3/packages/jev/src/output-admission-spill-budget.ts#L42)、[准入接入](https://github.com/luobosibing2/dsh-jev-plugin/blob/49d0994d8454162138ad8b13aa4cc235e76143f3/packages/jev/src/output-admission.ts#L219) 和 [集成验证](../../../../../packages/jev/tests/output-admission-integration.test.ts#L416)。本次不修改 DSH 源码或既有兼容版本范围。

## Alternatives considered

- Spill 先裁剪，再让 Jev 判断预览：会改变判断材料与处理位置，用户排除该方向及顺序模式开关。
- 固定一份 12K 或 12500 阈值：不能表达 profile 实际预算；相同数值的码点数也不等于宿主估算。
- 继续先处理全部适用长日志：在有限预算下不能实现两者的分工。
- 无策略或无预算时跳过 Jev：用户选择保留既有 Jev 行为。
- 新增宿主查询 API：现有公开运行配置、事件过滤与生命周期信息足以提供保守实现；只读“当前预算”本身也不能对应旧的在途回调。
- 仅在等待前后比较实例和配置引用：会遗漏同实例重启或临时新增后移除等中间变化，因此采用连续失效记录。

## Consequences

超预算结果不再消耗本次 Jev 判断，也不先做规则省略。原生预算内的长日志仍可做任务相关性去噪。执行期间的策略变化可能使一次本可去噪的结果原样通过，这是避免采用错误预算的代价。

Spill 可选模块存在但没有加载策略，与无法导入真实模块身份是不同情况；后者不能冒充无预算。恢复入口只能还原 Jev 实际收到的文本，不能还原上游已经丢弃的输出。宿主估算不是精确 tokenizer，本功能不保证任务准确率、真实 token 节省或自然任务收益。

## Verification

| 实际检查 | 结果与范围 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 通过；直接依赖更新后的离线锁文件与 frozen install 也通过 |
| `pnpm run typecheck` | 通过 |
| `pnpm run build` | 通过，同步 tracked runtime |
| 构建目录与 runtime 清单、内容逐项比较 | 87 个 JS/声明文件一致，使用既有 CSS 标记路径正规化 |
| 四个准入相关测试文件 | 73 项通过 |
| 最后新增及补强的定向测试 | 5 项通过、38 项跳过 |
| 实际构建入口的边界子集 | 5 项通过、38 项跳过 |
| `git diff --check` 与 staged 检查 | 通过 |
| PR CI `check` 与 `windows-smoke-commands` | 在提交 `941d370e8ec5f9c410ce42a62c708816d246cea4` 上均为 SUCCESS |

最终四个相关测试文件共有 74 项，由主轮和后续定向执行共同覆盖；没有声明最后完整重跑全部 74 项。测试使用 rc.2 正式发布依赖与本地 HTTP 固定回复，覆盖预算以下、相等、以上、profile 覆盖、UTF-16、无预算、零预算、原文与 Session 回读、完整替换计价、scope、重载、重启及 Loader 上下文刷新。构建入口子集另验证实际 `runtime/output-admission.js` 的动态策略身份匹配。

七个兼容发布版本核对过公开接口与发布文件，本次没有新跑七版本安装/Web 全矩阵，没有付费模型调用或自然任务收益实验。
