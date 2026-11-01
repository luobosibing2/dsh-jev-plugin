# Agent Note: Jev 多版本宿主兼容

Status: implemented

## Problem

GitHub Issue 19 的用户运行 DSH `0.2.0-rc.2`，原插件声明精确依赖 `0.2.1-alpha.2`。隔离测试显示，临时放宽声明能通过安装，但旧宿主的技能选择和指令检查因缺少 WorkingDirectory 服务不能激活。历史插件支持旧宿主，不代表升级后的当前包保留了同一兼容性。

## Decision

已交付的插件兼容 `0.1.7-rc.1`、`0.1.7-rc.2`、`0.2.0-rc.1`、`0.2.0-rc.2` 和 `0.2.1-alpha.2`。技能选择和指令检查逐操作获取生效的 WorkingDirectory 服务；存在时保留原生实时目录及其错误和取消语义，缺少时使用该旧宿主原生工具使用的 Session 目录。没有设置旧 Session 目录时，技能保留 undefined 让原生 provider 选择默认目录，指令证据保留进程目录默认值；Agentless 调用保持既有规则。

全部 34 个 DSH peers 使用 `>=0.1.7-rc.1 <=0.2.0-rc.2 || 0.2.1-alpha.2`，WorkingDirectory peer 可选，根包和 workspace 包的声明一致。Cordis 与 Loader peers 覆盖两个已验证宿主依赖版本，开发依赖继续精确固定 alpha.2。源码、tracked runtime、双语安装说明和公开验证报告共同交付；完整验收要求见同目录的 [Delta Spec](delta-spec.md)。

这组文件记录独立Jev插件的兼容性决策；产品实现位于隔离工作区（位置未公开），不随插件发行。先前已发布的 alpha.2 实测报告保留其原验证范围。

## Alternatives considered

**只放宽 peers。** 已实测安装成功后两个组件仍然等待不存在的服务，不能满足用户要求。

**继续仅支持 alpha.2。** 用户明确要求支持旧范围，因此补齐旧宿主兼容实现。

**在所有版本都使用最初 Session 目录。** 会丢掉 alpha.2 的实时目录切换能力，违反保留新版支持的要求。

## Consequences

旧宿主不再等待没有提供的目录服务，新宿主保留实时目录切换。两种消费者按 Session 隔离，不缓存服务缺失；生效服务的读取错误不会触发旧目录回退。支持区间有明确上界，alpha.2 独立精确纳入，alpha.1 与更高版本样例仍被官方检查拒绝。

Host 激活只说明依赖齐备；实际目录消费、原生工具与部分业务采用路径另有确定性验证。该验证不能建立模型语义质量、自然任务收益或 Windows 安装结论。原始诊断和 Session 证据保留在插件 worktree 的忽略目录中，公开报告只保留脱敏汇总。

## Verification

2026-10-11 本地实现已完成：两个消费者逐操作检查生效的目录服务，旧宿主使用自身 Session 目录，新宿主保留原生实时目录与失败处理。全部 34 个 DSH peers 更新为 `>=0.1.7-rc.1 <=0.2.0-rc.2 || 0.2.1-alpha.2`，WorkingDirectory peer 可选；两份 manifest 一致，开发依赖继续精确固定 alpha.2。npm 公共注册表按宿主 includePrerelease 规则核对，该旧版范围内恰有四个已发布版本，本轮均已测试。

修改前两个新增旧目录回归失败，修改后定向 39 个用例通过；类型检查、构建与 27 文件 / 346 用例回归通过。正式根包与 workspace 包在五个发布 CLI 的官方 Web profile 中安装、加载与已启用的确定性业务路径通过，共十次官方安装，全部九个 Host 组件保持激活，十三个 Host exports 导入成功。十份安装各 82 个生成文件、补丁与 peers 一致，根包三份和 workspace 一份 README 与当前文件一致。alpha.2 原生目录切换后，技能、指令证据和原生读取使用新目录。官方公开兼容检查函数接受五个目标版本，拒绝低于起点、旧区间之后、alpha.1 和 alpha.2 之后的未支持样例，没有设置版本豁免。

最早版本、0.2.0-rc.2 和 alpha.2 的实际浏览器页面显示十二个功能开关、九个运行组件与判断记录，三组 console error / warning 均为零。全部模型响应来自本地确定性 fixture，付费调用数为零；Windows、Desktop、Hub 与判断模型的语义质量未在本轮验证。公开产品报告保存在插件仓库 `docs/testing/2026-10-11-harness-version-compatibility/README.md`，原始证据保留在 worktree 的忽略目录内。

## Delivery

用户在本地验收后明确授权推送 MR 并合入主分支。功能提交 `471765ff5febdb36cfe77c40a9e407281c6ae9bb` 通过 [PR 20](https://github.com/luobosibing2/dsh-jev-plugin/pull/20) 于 2026-10-11 14:31:51 UTC squash 合入 GitHub `main`，合并提交为 `1d0733e6c022efa2f01aa8b101bf76dd96c38988`。GitHub 状态为 MERGED；fetch 后的 origin/main 与该 SHA 一致，其完整文件树与通过验收的功能提交相同。

本次 PR 没有报告 CI checks，GitHub 合并前状态为 MERGEABLE / CLEAN；验证依据为上述已完成的本地检查，未写成 CI 通过。GitHub 主分支已包含完整修复，[Issue 19](https://github.com/luobosibing2/dsh-jev-plugin/issues/19) 保持打开供原用户确认其 Windows 环境。三份本地任务文档整体进入 implemented，保留同目录链接；没有冷归档，也没有删除分支或 worktree。
