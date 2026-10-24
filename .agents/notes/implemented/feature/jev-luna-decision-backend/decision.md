# Agent Note: Jev / Luna Decisions 与双 API 接入

Status: implemented

## Problem

独立插件的业务功能共用一套Jev判断连接。用户需要自行选择Jev或Luna Decisions，并通过OpenAI官方或OpenRouter使用Luna，同时保留主模型、业务题目、阈值和原生权限机制。两种Luna API的输入、题目和答案表示不同，地址切换不足以兼容。

## Decision

由共用判断服务保存Jev、Luna/OpenRouter、Luna/OpenAI三套连接及当前选择，分别直接转换外部协议，业务功能继续使用既有JSON输入和Choice、Score、Noul含义。Jev与OpenRouter使用System One表示；官方Decisions使用完整input文本、问题数组与predicate。输入不摘要或截断，候选ID、等级索引及小数Score保留，实际可选字段不补造。任一拒绝或无效答案使整次判断失败。

旧配置默认Jev并保留原值；主模型、功能开关、题目、采纳阈值和权限规则独立于判断连接。Luna使用各自固定模型标识及插件专用默认凭据引用，合法自定义端点仍按显式API渠道处理。设置保存与凭据操作使用已保存连接身份，迟到动作不能覆盖另一渠道；每次尝试固定自己的连接、认证与截止时间，切换只影响后续尝试和人工重试。

OpenRouter超过200题时完整分批，所有批次共享原总超时并全部有效后才交付。失败不会自动重试、跨渠道回退或用Chat/Responses生成接口替代。网络记录保留实际发送内容、原始响应、返回模型及已知用量，另保存统一业务答案；业务判断、采纳、原生许可和工具执行分别记录。

阶段导航保留既有手动触发、逐step重建完整输入、材料及连接指纹复用规则。新记录按实际协议重放原始响应来核对统一答案；旧Jev记录保持原有读取，缺失身份或用量不补造。实现见[连接身份解析](https://github.com/luobosibing2/dsh-jev-plugin/blob/79cdf65083f19bf5d9c76e3adfa0f3030f057bad/packages/jev/src/types.ts#L48)、[协议编码与解码](https://github.com/luobosibing2/dsh-jev-plugin/blob/79cdf65083f19bf5d9c76e3adfa0f3030f057bad/packages/jev/src/wire.ts#L133)、[实际网络交换](https://github.com/luobosibing2/dsh-jev-plugin/blob/79cdf65083f19bf5d9c76e3adfa0f3030f057bad/packages/jev/src/adapter.ts#L82)及[记录读写](https://github.com/luobosibing2/dsh-jev-plugin/blob/79cdf65083f19bf5d9c76e3adfa0f3030f057bad/packages/jev/src/ledger.ts#L121)。

[Delta Spec](delta-spec.md)保留完整最终行为及验收要求，本记录拥有转换底座、替代方案、代价和实际交付事实。三文件记录本功能的实施与交付；实施对象是独立的@dsh-jev/plugin，不修改DSH产品源码。

## Alternatives

**只编辑原地址与模型。** 不能保留三套可直接切换的连接，也不能处理官方问题数组、概率数组及refusal，不能满足双API要求。

**只支持OpenRouter。** 用户明确要求官方API，单渠道无法满足范围；目前OpenRouter真实访问限制也不能成为删除已实现协议兼容的依据。

**让业务模块分别接入提供方。** 会把协议与认证差异传播到所有消费者、记录和阶段复用。共用服务已经拥有有限判断类型、取消、失败与持久记录，直接适配更少改动。

**以官方外部格式重写全部业务，或保存合成的System One原始响应。** 前者增加与模型选择无关的消费者迁移，后者使历史一致性检查失去真正原始回答。现有业务类型作为基础、两协议直接解码，同时保留实际原始数组。

**新增完整提供方SDK或通用模型平台。** 当前网络操作已由既有DSH LlmAdapter覆盖；SDK不能代替有限业务语义转换，新增客户端仍需重新对齐截止时间、凭据和记录。没有独立通用平台需求。

## Consequences and boundaries

输入和OpenRouter分批可能重复发送共享上下文，增加用量与时延；原10秒请求超时、日志等待和采纳门槛不变。失败中缺失用量明确保留，用量完整性不与业务成功混同。两渠道有效答案可映射为同一业务含义，不保证真实概率、confidence或最终选择相同。

模型选择不授予权限。工作区审批只有明确approve及最终输入新鲜性检查后，才交给原生allowed-once；非肯定仍回原生人工答复。confidence不是实测准确率，判断成功不等于执行成功。记录不存认证头或密钥，UI只展示凭据存在、来源和可写状态。

OpenAI真实可用由已执行请求确认；OpenRouter一次真实请求因提供方访问限制返回403，用户要求停止，该渠道尚无真实成功答案。一次真实审批成功不抹去前两个受控未批准样例，原因及稳定性未确定。固定合成材料不能估计自然任务准确率、平均收益或费用；GUI cold stage及未触发业务功能没有新增真实覆盖。

相关[阶段导航决策](../jev-whole-step-stage-navigation/decision.md)继续拥有完整step、授权读取和复用规则；[既有Jev评测决策](../../testing/jev-deepswe-paired-evaluation/decision.md)的效果仍按当时模型和材料解释，不自动成为Luna效果依据。

## Verification

产品与runtime提交为0e81f3d，原27文件/300项本地测试、Host/Client构建与类型检查通过。最终构建包经官方DSH 0.1.7-rc.2安装到两个隔离Web profile，82个runtime逐字节一致；固定localhost的8次请求检查三连接、设置保存、迟到结果、拒绝、原始数组展示、重启及profile隔离。协议、安装与真实模型效果分别记录。

官方受控campaign有6次真实HTTP200/gpt-6-luna，包括三题诊断及5个业务样例。固定三题保留left、0.49、0.98及原始数组；两条授权审批为unauthorized，保护路径成立但正例未达预期。真实DeepSeek Flash的两个任务及首Session续验另有14主模型/3Luna请求全部200：实际160个TS模块、sum12880、哈希及退款3/3一致；五路径均得1，顺序未改善；首份7127码点日志因格式无候选而完整保留。相同模块的数字进度续验按原0.8门槛将8407缩至2122（74.76%），原生spill由验收者逐字回读，实际后续主请求收到相同缩短文本，最终事实准确。一次approve .68形成原生allowed-once、执行回执和准确文件，长期mode未变。完整公开证据见[中文报告](../../../../../docs/testing/2026-10-07-luna-decisions/public-results.zh-CN.md)及[精简数据](../../../../../docs/testing/2026-10-07-luna-decisions/results.json)。

发布前在clean head 8420dd9重新构建，并通过官方安装与同来源5帧GIF验证正常GUI切换Jev→Luna/OpenAI、保存及一次真实官方固定诊断。该额外请求HTTP200、gpt-6-luna、393/0tokens，未运行主Agent生成，12业务开关保持关闭；与此前实验计数分开。Key只来自环境且未保存。浏览器沿用IAB上下文、新分配origin，清理origin存储能力不受支持，首次使用声明已观察到；该例外在PR录制说明披露。GIF仅进入独立media assets分支，不进入main代码历史。

公开报告中英文一致、JSON事实与原始核对结果一致、本地22个HTML页/277内部链接及浏览器内容检查通过；源码和发布材料未包含提供的密钥或私有原始Session。没有因文档发布重复付费业务验真。

## Delivery

[PR #11](https://github.com/luobosibing2/dsh-jev-plugin/pull/11)实际状态MERGED，合并提交为79cdf65083f19bf5d9c76e3adfa0f3030f057bad，合并时间为2026-10-08 00:20（北京时间）。GitHub main及本地独立仓库main已到该提交，功能head 8420dd9和产品提交0e81f3d均为其祖先。本地main干净，其他分支/PR与日常profile未修改。

[GitHub Pages部署](https://github.com/luobosibing2/dsh-jev-plugin/actions/runs/37651209790)的build和deploy均成功，head为同一合并提交；[在线连接与验真页](https://luobosibing2.github.io/dsh-jev-plugin/connections/luna-decisions.html)可见新内容。在线首页、连接页、报告镜像及文件排序/日志/审批三个案例页均HTTP200，与本地构建逐字节一致。官网保留11个业务页，新增独立连接页和公开证据镜像，首页及日志/排序/审批页均关联新报告。累计Full Spec未生成或合并，不清理实验工作区或删除分支。
