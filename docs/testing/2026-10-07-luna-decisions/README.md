## 直接答案

Jev / Luna 双 API 接入及有限验真结果见[中文报告](public-results.zh-CN.md)、[English report](public-results.md)和[精简结果数据](results.json)。OpenAI 官方 Luna 在受控样例及真实主模型任务中均返回指定模型；OpenRouter 的唯一真实诊断返回提供方访问限制的 HTTP 403，此后停止。协议支持、真实 API 可用性、判断采纳与实际执行分别记录。

The [English report](public-results.md) separates protocol and installation checks, controlled live samples, and real main-model tasks. Official OpenAI Luna returned the specified model in the executed samples. The only live OpenRouter diagnostic returned a provider-access HTTP 403 and was stopped. API success does not establish semantic accuracy or task benefit.

## 三层证据

| 层次 / Layer | 已执行范围 / Executed scope | 主要边界 / Main limit |
| --- | --- | --- |
| 协议及安装 / Protocol and installation | 27 文件、300 测试；官方 DSH Web 的两个隔离 profile、8 次固定 localhost 请求 / 27 files, 300 tests; two isolated official DSH Web profiles and eight fixed localhost requests | 固定服务验证接线，不证明提供方可用性 / Fixed providers establish integration, not provider availability |
| 受控真实 Luna / Controlled live Luna | 官方 6 次 HTTP 200，6,541/0 input/output tokens；OpenRouter 1 次 HTTP 403 / Six official HTTP 200 requests, 6,541/0 input/output tokens; one OpenRouter HTTP 403 | 主模型与部分工具材料固定；两个审批正例均未自动批准 / Fixed main-model and some tool material; neither approval positive case was automatically granted |
| 真实主模型任务 / Real main-model tasks | 两个 DeepSeek Flash 任务及首个 Session 一次续验，14 次主模型与 3 次 Luna 请求均 HTTP 200 / Two DeepSeek Flash tasks and one continuation in the first Session; 14 main and three Luna requests, all HTTP 200 | 可丢弃合成项目与额外 QA 限制；不建立自然任务准确率或稳定收益 / Disposable synthetic projects with extra QA limits; no natural-task accuracy or reliable-benefit estimate |

## 阅读入口

- [中文结果](public-results.zh-CN.md)：连接、实验条件、独立效果和未验证项。
- [English results](public-results.md): the same conditions, results, and limitations.
- [results.json](results.json)：手工精简的计数、规范答案与相对夹具路径，不含原始捕获。
- [配置判断连接](../../../README.zh-CN.md#配置判断连接) / [Configure the judgment connection](../../../README.md#configure-the-judgment-connection)。
- [验证总览](../../validation.md) / [Validation overview](../../validation.md)。

## 边界与验证

本目录公开结果经过精简；原始 Session、HTTP body、请求标识、认证头、凭据、个人路径、profile 位置和临时 spill 定位符保留私有。公开数据不替代原始记录，也不提供凭据或自动付费重跑入口。产品行为及配置见[包参考](../../../packages/jev/README.md)，各次成功、拒绝、旁路和未达预期结果均保留。
