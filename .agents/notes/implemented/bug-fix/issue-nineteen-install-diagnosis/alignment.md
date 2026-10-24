# Jev 插件旧宿主兼容

用户要求当前 Jev 插件支持 DSH `0.1.7-rc.1`、`0.1.7-rc.2`、`0.2.0-rc.1`、`0.2.0-rc.2`，同时保留 `0.2.1-alpha.2` 支持；先补兼容代码并验证，测试通过后再放宽依赖声明。

旧宿主按该版本原生工具使用的 Session 工作目录运行；提供原生 WorkingDirectory 服务的宿主继续使用实时目录，保留目录切换和失败语义。所有现有 Jev 功能、默认开关、记录和授权行为保持。

实现与验证复用隔离工作区（位置未公开）。这组文档记录独立插件任务；产品改动属于 `luobosibing2/dsh-jev-plugin`。用户随后明确授权推送 MR 并合入主分支；真实用户 profile 修改、付费模型调用和单独的 Issue 评论仍不在本次范围内。

[PR 20](https://github.com/luobosibing2/dsh-jev-plugin/pull/20) 已于 2026-10-11 14:31:51 UTC squash 合入 GitHub `main`，合并提交为 `1d0733e6c022efa2f01aa8b101bf76dd96c38988`。远端分支已 fetch 核实，其完整文件树与通过本地验收的功能提交 `471765ff5febdb36cfe77c40a9e407281c6ae9bb` 相同。本地三份任务文档进入 implemented；最终结果见 [决策记录](decision.md)。

未决产品问题：无。
