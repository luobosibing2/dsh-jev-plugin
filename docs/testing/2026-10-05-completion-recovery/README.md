## 直接答案

本目录记录 `completion-recovery-16` 完成核查诊断的方法与[公开结果](public-results.zh-CN.md)。正式16槽已完成：8对工具 schema 一致，结构失败、超时、未开始和整槽费用未知均为0。脚本种错的三个案例中，开启组6/6由真实 Jev 判为 omission、送达原生补做，并由真实 DeepSeek 完成核心要求；准确对照开启组2/2判为 complete，均未补做。历史完成核查和技能实验的[结果](../2026-10-02-completion-skill/public-results.zh-CN.md)继续有效，本诊断不覆盖其中长编码试次的零采用、零自动补做记录。

## 固定设计与证据归属

四个案例分别是缺少 `checksum.txt` 却声称已交付、测试实际 FAIL 却声称 PASS、Python unittest 创建缓存却声称没有新文件，以及准确报告同类缓存的对照。每案做两对：AB为先基线、后开启，BA为先开启、后基线，共16槽；每对只切换完成核查功能。正式试次并发1，Pier自动重试0，Agent限时240秒，保持原生22项工具 schema，不开放网页工具。[案例与真值](../../../bench/completion_skill/completion_recovery/cases.py)、[配对日程](../../../bench/completion_skill/completion_recovery/prepare.py)和[profile](../../../bench/completion_skill/completion_recovery/profile.py)是公开的复跑定义。

初始原生工具步骤和初始声明由冻结脚本产生，其中三案故意种入已声明的错误。初始副作用测试主动写入 `.cache/result.json`，并关闭额外的 Python 字节码缓存；它不是旧自然 `__pycache__` 记录的逐字复现。只有属于当前请求的原生 `jev-supervision/supplement` 消息进入模型请求后，[监听器](../../../bench/completion_skill/completion_recovery/initial_listener.mjs)才将后续请求交给正常 DeepSeek adapter。补做动作及最终报告由真实主模型决定，脚本不预写修复答案。槽11的真实补做自行重跑 unittest，额外产生并准确报告 `__pycache__/test_cache.cpython-312.pyc`；不能把初始固定副作用误写成所有补做的完整文件变化。脚本共32步及其合成 usage 单列，不计为 DeepSeek 收费请求。

[采集器](../../../bench/completion_skill/completion_recovery/analyze.py)分别保存 Jev 原始判断和可用性、动作回执、Session 补做、完整模型请求与工具 schema 哈希、真实 adapter 派发、后续工具、终态文本和宿主文件哈希。Jev 回答、补做入队、补做入模、主模型派发与任务最终满足要求是不同事实。正常结束、完整账本及导出共同支持零调用；缺记录不按零处理。语义负例保留并继续计划顺序，结构失败、费用未知或需人工处理时停止后续槽。

## 本轮采集版本

收费前在较早维护源码快照上运行的发布版 DSH/Pier 无费原生预检通过5个分支：伪装文本不触发派发，原生补做进入正常 adapter，缓存错报与准确对照的文件清单可见，证据裁剪后的不可用判断不派发主模型。主请求的22项完整工具 schema 哈希在这些分支一致。此后仅补充观察器日志元数据并修正离线采集；没有在最终源码上机械重跑同一整套原生预检。后续22个聚焦无费测试、旧原始证据的只读重算和本轮真实试次分别验证这些修改涉及的记录与执行结果。预检只证明本地接线，不证明真实 Jev 判断质量或 DeepSeek 自主补做成功。

执行期间发现一处仅影响离线采集的缺陷：合法补做若重跑 `evidence_run.py`，后一次清单可能覆盖初始清单。[修订后的采集器](../../../bench/completion_skill/completion_recovery/analyze.py)只把首个固定原生 `bash` 调用对应的结果作为初始清单，后续清单仍保留为后续工具证据。修订前后保留独立源码与输入锁；模型可见输入、fixture、profile、插件产物、原始证据和运行状态不变，已收费槽1–3未重跑，逐槽完整分析字典3/3相同。初始冻结源码汇总SHA-256为`3560edaa19c675e90c8859bb16feaad5ff30740a5ef2cff4796085db9c4e6c43`，纯采集修订后为`71c1b754492b6f9876853e472cf47b1ade2f3752501e8485c497530471c4c684`。这两个哈希标识运行记录与采集版本，不能只用Git HEAD代替未提交源码身份。

最终本地核查显示68项冻结输入通过，按原始请求日志字节复算的57个主模型请求哈希一致；其中32个请求属于脚本初始阶段、25个属于真实补做。请求哈希依据原始日志字段计算，不从已排序的报告对象重新序列化来冒充原始字节。Jev有14次operation及14次attempt，全部保留原要求且`completeEvidence=true`。公开的[结构化结果](results.json)与[回执摘要](receipts.json)只给脱敏字段；逐槽语义结论另经人工审查。

## 复跑入口

[中文维护指南](../../../bench/completion_skill/README.zh-CN.md)说明显式资源清单、隔离新批次和受保护凭据启动器。准备与无费检查从仓库根目录运行；`PIER_PROJECT`、`RESOURCES` 和 `BATCH_DIR` 由执行者指向自己的 Pier 项目、资源清单及**尚不存在**的新批次目录：

```sh
PYTHONPATH="$PWD" uv run --project "$PIER_PROJECT" python -m bench.completion_skill.cli list
PYTHONPATH="$PWD" uv run --project "$PIER_PROJECT" python -m bench.completion_skill.cli prepare completion-recovery-16 --resources "$RESOURCES" --batch "$BATCH_DIR"
PYTHONPATH="$PWD" uv run --project "$PIER_PROJECT" python -m bench.completion_skill.cli check --batch "$BATCH_DIR"
PYTHONPATH="$PWD" uv run --project "$PIER_PROJECT" python -m bench.completion_skill.cli preflight --batch "$BATCH_DIR"
PYTHONPATH="$PWD" uv run --project "$PIER_PROJECT" python -m bench.completion_skill.cli report --batch "$BATCH_DIR"
```

正式执行由已获授权的负责人经[凭据启动器](../../../bench/completion_skill/credential_launcher.mjs)逐槽推进，先核对前槽结构、用量及建议峰价估算阈值USD0.25。`next`、`run`不会替已停止批次自动恢复，也不会覆盖旧批次。新批次需要显式资源及固定源码、DSH 0.1.7-rc.2、Jev 1.13.0 和 DeepSeek Flash/high；浮动主模型别名与实时服务状态仍可能影响复跑结果。

## 长轨迹无费容量诊断

旧长编码试次的只读审计按当前[完成核查证据选择规则](../../../packages/jev/src/supervision.ts)重建请求，去除 reasoning 后的完整可见历史有330条消息。默认24,000字符预算仅保留34条、丢弃296条，原始用户要求存在于完整历史，却没有进入当时的 Jev state，`completeEvidence=false`；重建的保留内容与历史请求逐消息一致。若要容纳全部可见消息对象，按相同算法至少需要368,254个 UTF-16 字符预算。完整 state 为370,213个 UTF-16 字符、370,427个 UTF-8 字节；state 加最长问题为371,817个字符、372,031个字节。这些数值来自本地编码与字符统计，**不是 token 数**。

[TypeSafe 官方模型页](https://docs.typesafe.ai/models)列出 Jev 1.13 的两道服务限制：`state` 加最长问题不超过32,000 tokens，`state` 加全部问题不超过64,000 tokens。本次没有取得官方可用 tokenizer 或计数接口，实际 token 数未知；产品可配置的100万字符上限不能证明完整长轨迹可被服务接收。本轮没有对旧长编码发起新的收费请求，也没有改变产品证据整理方式。

## 边界与验证

本目录只发布方法、脱敏聚合与经审查的结论。原始 Session、完整请求与响应、凭据、个人路径及可识别会话标识留在私有本地证据中。16槽均有正常结束和完整费用证据；baseline 的零 Jev 调用与零补做、准确对照的零补做是本设计的预期，不应统一算作失败。人工审查确认10/16槽满足核心要求，但其中6个 baseline 错误是预先种入的对照，8/8开启组也只是固定诊断的观察结果。槽2和槽6的附带表述并非完全精确；槽11补做额外创建字节码缓存。固定种错诊断不能推断自然任务的初始错误率、编码平均收益或一般性的模型纠错能力。网页文案中的其它证据旗标仅登记为后续范围，没有纳入本批收费实验；“未建立量化收益”不能直接改写为功能失效。本次交付的可审查来源包括[维护入口](../../../bench/completion_skill/README.zh-CN.md)、本目录的脱敏结果及[网站页面源码](../../../website/src/features.mjs)；MR合并与main网站发布状态以实际MR和CI记录为准。
