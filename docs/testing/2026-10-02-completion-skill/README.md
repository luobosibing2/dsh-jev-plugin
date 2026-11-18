# Completion and Skill Evaluation Evidence

本目录保存2026-10-02完成核查与技能选择实验的脱敏历史结果，包括首批26槽和后续12个计划槽。后续实际运行10槽，编码开启组遇到证据裁剪后的人工处理要求，另2槽未启动。

This directory preserves sanitized historical completion-check and skill-selection evidence: the initial 26-slot suite and 12 planned follow-up slots. Ten follow-up slots ran; the enabled coding trial required human handling after evidence was cropped, so two coding slots remained unstarted.

## 文件 / Files

- [中文结果说明](public-results.zh-CN.md)：条件、判断与采用、独立结果、未知项及外推边界。
- [Structured results](results.json): planned denominators, per-slot metrics, known usage, incomplete costs, and unstarted slots.
- [公开回执摘要 / Receipt summaries](receipts.json)：原始判定与可采用判定分开，保留取消和补做状态；不含原始请求、响应或Session。

## 复跑入口 / Rerun entry

维护入口为[完成核查与技能评测指南](../../../bench/completion_skill/README.zh-CN.md)（[English](../../../bench/completion_skill/README.md)）。固定实验标识如下：

| 实验标识 / Scenario | 范围 / Scope |
| --- | --- |
| `initial-26` | 六类固定完成记录、六类基础技能案例、原始编码一对；26槽。Six fixed completion pairs, six basic skill pairs, and one coding pair. |
| `coding-followup-4` | 同一原始编码任务两次配对，AB/BA，Agent 1800秒；4槽。Two coding pairs with a 1800-second Agent limit. |
| `skill-repository-8` | 两道24技能仓库调查题，各两次配对，AB/BA；8槽。Two 24-skill repository investigations, each repeated in AB/BA order. |

重跑创建新batch，使用显式资源清单和正常凭据，不默认恢复已halted的批次。运行记录包含维护代码Git HEAD、dirty状态和源码哈希；仅Git HEAD不能描述未提交的脚本修改。Docker、固定资源、依赖与API凭据仍需在运行机器上可用。

A rerun creates a new batch from explicit resources and credentials; it does not silently resume a halted batch. Each batch records the runner Git HEAD, dirty state, and source hashes. Runtime dependencies, Docker, pinned resources, and API credentials remain prerequisites on the execution machine.

本目录的数字来自当时本地冻结driver。入库的维护入口经过路径整理与无费验证，不是这些历史输入锁对应源码的逐字快照，也没有因本次提交再运行收费实验。主模型别名浮动且采样有差异，重跑不承诺逐字答案或相同分数。

The figures describe the historical frozen local drivers. The maintained entry points were reorganized and checked without paid inference; they are not byte-identical snapshots of those drivers, and this commit does not claim a new real-model run. Floating model aliases and sampling mean reruns need not produce identical answers or scores.

## 维护入口验证 / Maintained runner validation

最终维护包49个文件的汇总SHA-256为`eebda1a3bfd00e529666c5ad573b9a6f01a66fff3db5978b3aecf00f74c9caf0`，由`source_snapshot()`规定的逐文件哈希计算。在不含旧artifact源码的干净Git副本中，`pnpm install --frozen-lockfile --offline --ignore-scripts`成功，三个场景的`prepare`和`check`分别通过26、4、8槽；`python -m unittest bench.completion_skill.tests.test_portable -v`为11/11通过。资源由副本外显式JSON提供，副本准备时记录`worktree_dirty=false`。

The final maintained package contains 49 files with aggregate SHA-256 `eebda1a3bfd00e529666c5ad573b9a6f01a66fff3db5978b3aecf00f74c9caf0`, calculated by `source_snapshot()`. A clean Git copy without historical artifact source installed declared dependencies offline, prepared and checked all three scenarios, and passed 11 focused keyless tests. Its external resources came from an explicit JSON manifest, and preparation recorded a clean worktree.

发布版DSH原生无费探针中，初始完成核查2槽和基础技能6槽在较早的维护代码快照通过。干净副本首次24技能探针发现mock服务pid文件尚未生成就被判断为退出的竞态；失败记录保留，局部修复保持原10秒上限，受控屏障测试覆盖延迟pid创建与已退出进程。最终源码的24技能探针4/4通过，运行后输入锁仍通过。真实DeepSeek/Jev调用为0；编码后续只校验原题、Pier job及verifier配置。凭据启动器仅做语法和根路径检查，本次没有使用真实凭据执行收费路径。

Published-DSH keyless probes passed two initial completion trials and six basic skill trials on an earlier maintained snapshot. The first clean-copy repository-skill probe exposed a mock-service readiness race before PID-file creation; its failure was retained. A narrow fix kept the original ten-second limit and added controlled regression coverage. The final source then passed all four repository-skill probes and the post-run input-lock check. Real DeepSeek/Jev calls were zero. Coding validation checked the frozen task, Pier job, and verifier configuration; the credential launcher received syntax and root-path checks without a new paid execution.
