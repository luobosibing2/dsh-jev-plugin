# Jev 完成核查与技能实验

此包维护四个有固定名称的实验场景。准备场景会创建**新批次**，不会恢复或改写旧运行。被测插件由 tar 包显式提供；这里不修改 Jev 或 DSH 产品代码。

| 场景 ID | 试次 | 主模型 | 配对变量 |
| --- | ---: | --- | --- |
| `initial-26` | 26 | 六组完成核查使用脚本主模型；六组技能与一组编码使用 DeepSeek Flash | 每对只开启完成核查或技能选择之一 |
| `coding-followup-4` | 4 | DeepSeek Flash | 原 Vitest 题上的完成核查，AB/BA 两对 |
| `skill-repository-8` | 8 | DeepSeek Flash | 两道固定 24 技能仓库调查题，各做 AB/BA 两对 |
| `completion-recovery-16` | 16 | 初始工具与声明由脚本产生；仅原生 Jev 补做后由 DeepSeek Flash 处理 | 四个固定完成案例，各做 AB/BA 两对 |

提交的[资源示例](resources.example.json)列出所有外部输入。把它复制到仓库外，再将相对 `paths` 改为自己的资源位置，并准确填写版本、任务、模型路由、端点和凭据引用名。相对路径以资源 JSON 所在目录为基准。DeepSWE 与 Pier 必须处于声明的 commit，Node 归档与插件 tar 必须符合声明的 SHA-256；Docker 镜像固定到 digest。可选 `dsh_install` 目录包含该 DSH 版本的 `package.json`、`package-lock.json` 和 `identity.json`；不提供时，准备命令会在新批次生成 npm 锁。两种方式都不依赖历史批次。

场景固定任务、DSH 版本、主模型/Jev 路由、功能开关、工具、顺序、时限和停止规则。资源文件可显式声明新的 `versions.plugin_commit`、与产物吻合的 `versions.plugin_tar_sha256` 或价格快照；这会形成不同且可追溯的批次身份。已有 DeepSWE 校验器核对真实 tar 字节、Node 归档、源码 commit 和价格字段。批次记录场景 ID、Git HEAD、脏工作树状态、维护代码逐文件哈希、资源文件哈希、产物哈希、镜像、manifest、job 和输入锁。存在未提交修改时，Git HEAD 本身不能代表完整代码身份。浮动 `deepseek-flash` 别名、实时服务状态和凭据可能变化，因此新批次不保证逐字或同分复现。

在仓库根目录，安装 Python `uv`、Node/pnpm、Docker，备齐声明的资源及 Pier 依赖后运行：

```sh
pnpm install --frozen-lockfile
PYTHONPATH="$PWD" uv run --project /path/to/pier python -m bench.completion_skill.cli list
PYTHONPATH="$PWD" uv run --project /path/to/pier python -m bench.completion_skill.cli prepare initial-26 --resources /path/to/resources.json --batch /path/to/new-batch
PYTHONPATH="$PWD" uv run --project /path/to/pier python -m bench.completion_skill.cli check --batch /path/to/new-batch
PYTHONPATH="$PWD" uv run --project /path/to/pier python -m bench.completion_skill.cli preflight --batch /path/to/new-batch
PYTHONPATH="$PWD" uv run --project /path/to/pier python -m bench.completion_skill.cli report --batch /path/to/new-batch
```

把 `initial-26` 换成 `coding-followup-4`、`skill-repository-8` 或 `completion-recovery-16` 即可准备其他场景。`check` 校验冻结源码、由资源生成的 manifest、profile、任务、运行时锁和 Pier job。`preflight` 在适用场景用发布版 DSH、本地模型服务和回环 Jev 做无密钥原生接缝验证；编码后续保留原任务与 verifier，但不存在能替代真实编码模型的无费主模型。probe 输出与收费试次输出分离，不能据此声称真实服务效果。

技能分析和预检按目录中记录的 `source.selection` 概率阈值与数量上限核对发布结果；缺少该元数据的目录保留历史 top5 规则。原始排名的 `recall@5` 与实际选择名称、遗漏的必需技能分别报告。只有完整判断成功且 `skill-catalog-no-relevant` 回执为 observed 时，空选择才有效；判断失败、取消、回答不完整或未采用时，实际选择名称保留为未确定。

`completion-recovery-16` 固定缺交付文件、FAIL 错报 PASS、Python unittest 缓存副作用错报和准确报告缓存的对照。Python 测试主动写入 `.cache/result.json`，并关闭字节码缓存；这是固定副作用探针，不是旧自然 `__pycache__` 记录的复跑。监听器仅生成初始原生工具调用与错误或准确声明；当前请求的原生 `jev-supervision` `supplement` 消息进入模型请求后，才把后续请求交给正常 DeepSeek adapter。无费预检沿发布版 DSH/Pier 路径使用本地 Jev 与回环 DeepSeek Messages 服务，核对原生传递、基线/对照/证据不足时零派发、两臂完整的 22 项工具 schema 与哈希、文件清单和分阶段用量。报告保留全部槽、原始请求与 Session 证据、宿主文件哈希、未知费用和待人工语义审查字段。另记 DeepSeek 请求别名及派发时间；DSH 流不导出服务响应 model ID，该字段记 `null`。初始脚本用量不计 DeepSeek 费用；固定种错诊断不能推断自然初始错误率或普遍编码收益。

正式执行前，在 DSH 本地凭据中配置声明的 `DEEPSEEK_API_KEY` 与 `JEV_API_KEY` 引用，或用受保护的非 TTY 管道及 `--jev-key-stdin` 提供 Jev 凭据。启动器读取引用，不保存凭据值，只向串行 runner 传递。`initial-26` 的完成核查试次使用本地脚本主模型，执行 `next` 时只需要 Jev；其中的技能和编码试次及两个后续场景需要两家真实服务。建议每次只推进一槽并审阅报告：

```sh
node bench/completion_skill/credential_launcher.mjs next --batch /path/to/new-batch --execute
PYTHONPATH="$PWD" uv run --project /path/to/pier python -m bench.completion_skill.cli report --batch /path/to/new-batch
```

用 `run` 代替 `next` 会串行推进，直到全部试次完成或命中停止条件。存在运行中/已暂停试次、证据不完整、费用未知或达到建议支出阈值时，不再发起后续请求。没有自动重试或隐式重置。重跑时按场景 ID 建立新批次。历史结果另见仓库测试报告；它们出自原始冻结 driver，并非维护入口重新收费执行的结果。

针对性的无密钥测试：

```sh
PYTHONPATH="$PWD" uv run --project /path/to/pier python -m unittest bench.completion_skill.tests.test_skill_selection bench.completion_skill.tests.test_portable -v
```
