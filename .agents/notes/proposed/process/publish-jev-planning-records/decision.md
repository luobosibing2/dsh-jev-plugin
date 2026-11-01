# 公开 Jev 规划记录并默认跟踪 Git feature 文档

状态：proposed。用户已明确要求所有 Jev 规划记录公开及未来默认跟踪；Jev 公开文档已整理并验证，目标分支尚未确认合并。通用默认值已完成本地提交和安装。[Delta Spec](delta-spec.md) 拥有完整行为和验收。

## Problem

Jev 的历史规格分散在 DSH 和 Jev 的本地 Notes，Git 忽略及仓库规则阻止公开审查。Superpowers 同时从 helper 和多份说明强制三文件永久 local-only，只修改说明或本次 force-add 无法改变以后会话的默认行为。

## Proposal

以 Jev 仓库作为公开记录入口，导入十一组明确 Jev 三文件并维护本次任务记录。清理公开文本的本机引用，保留历史事实、负结果及私有数据边界。用正常 Git 跟踪和独立文档 MR 发布，不把规划材料加入运行时安装包。

修改通用 helper 与 Skill，使 Git feature 默认可跟踪，保留 root 的显式关联、内容判断和 Git 提交职责。三文件在 primary 的工作权威不变，任务分支提交同一份内容，合并后语义改写和整组移动也进入代码历史。Hook 不自动暂存、提交或决定交付。

从当前安装对应源码创建独立本地变更，以干净精确提交更新本机插件；已有未公开历史与 Jev MR 分开。

## Alternatives considered

只 force-add 本次文件：不能解决未来 bind 和 Stop 继续拒绝 tracked 文档，也不符合用户要求的通用默认变化。只改 Skill：运行脚本仍会强制忽略。全局清除所有旧 exclude：超出公开 Jev 材料的授权，可能影响其他私有任务。直接推送 Superpowers 当前分支：会带入八条既有未发布提交，包含其他 Skill 改动。

## Acceptance criteria

十一组既有记录和本次记录正常纳入 Git，干净 checkout 可读，不含本机私有入口。新 feature 可正常暂存，已跟踪 feature 可绑定并保存，当前 feature 的旧精确 exclude 可清理，无关排除不变。路径与生命周期保护、非 Git 行为保持。安装后的未来会话采用新默认，实际状态与发布目录对应。

## Risks

公开历史记录不等于重新验证旧实验；未公开原始数据也不能用虚构链接替代。primary 权威与 worktree 提交需要 root 明确同步同一份内容；自动提交会扩大 Hook 的职责。旧会话已注入的 Skill 文本仍来自旧版本，只有新的安装及未来会话采用新默认。

## Verification

公开导入包含十一组既有 Jev 记录及本过程组，共三十六个三文件记录和一份 Notes README。DSH 的 OAuth 规划未导入。根英文和中文 README 各有入口，AGENTS 改为默认 Git 跟踪，gitignore 只删除三条 Notes 生命周期排除；本次两个明确 feature 的八条旧 helper 精确排除已撤销，无关私有排除保留。

原记录引用的十二个 PR 已通过 GitHub 重新核对为 MERGED。PR #10 的公开三文件按实际交付的十六槽诊断和网站资料移入 implemented，长轨迹产品修复仍未纳入交付。PR #7 的网页 MR 状态已修正，没有据此新增线上部署验收。日志受控案例没有确认的合并依据，保留 proposed。

| 检查 | 结果与范围 |
| --- | --- |
| 历史要求保留性 | 十二份 Delta 的 381 处 REQ 引用与来源一致；ADDED 正文排除链接目标差异后逐字一致 |
| 历史数字保留性 | 对照三十六份来源，排除 URL 与个人路径后正文数字无丢失；新增验证数据另列 |
| 内部及精确源码引用 | 原公开整理的 80 个内部引用、34 个 Jev/DSH 精确 commit 文件、3 个 DeepSWE/Pier API 目标有效 |
| 公开文本 | 不含个人绝对路径、本机 worktree 链接或检查覆盖的明显秘密；八处私有原始材料保留未公开说明 |
| 安装包 dry-run | `npm pack --dry-run --json --ignore-scripts` 列出 97 个文件，Notes 为零 |
| 通用 helper 与消费者 | `python3 -m unittest discover -s tests -p 'test_*.py'`，三个文件 56 项通过 |
| 修改的 Skill | writing-plans 与 generate-full-spec 的 Skill Creator quick_validate 均通过；五 Skill 共 499 行 |
| 实际安装 | 官方 marketplace 和 plugin 命令安装 `6.1.1+codex.202610250001`，installed/enabled 均为 true |
| 精确部署来源 | 本地提交 `5b1794a7626406630a68e4f4bc26c3b67232c909`、干净发布目录、安装 cache 的 38 个 tracked 文件逐项相同 |
| 已安装 helper 冒烟 | 新三文件正常 git add、tracked 重绑定、SessionStart 新规则、Stop 更新 tracked proposed 均通过，无自动暂存或提交 |

Superpowers 改动位于独立本地分支 `codex/version-feature-planning-documents`，没有推送；其已有八条未发布历史也未公开。新会话读取新的安装版本；已有会话已注入的旧 Skill 文本未被声称即时替换。历史实验没有重跑，DSH 产品源码及原始导入来源保持原状。
