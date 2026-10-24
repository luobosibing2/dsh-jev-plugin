# Decision: Jev 配对评测与公开测试依据

Status: implemented

## Problem

插件的确定性接线测试与有限真实样例不足以说明完整编码任务是否受益，也缺少维护者可运行的配对管线和可公开复查的文件路径排序结果。Jev判断、结果进入模型上下文、主模型最终答案及独立测试判定分别需要实际记录支持。

## Decision

维护者管线通过正式DSH profile启动Agent，由Pier提供隔离trial。编码任务沿用DeepSWE原始任务与独立verifier，提供baseline、日志准入和完成核查三组；阶段导航与其他未测功能关闭。文件排序采用六个固定人工案例，候选数0、1、12、16、40、41，每例关闭/开启各一次；两组selection模块均加载，只有file-ranking开关不同，保留相同模型工具目录。默认候选40、显示12，0与超过40候选整体旁路，grep不排序。

输入、组件、产物、模型路由、运行条件、价格与调度顺序在执行前固定。使用正常DSH凭据服务或显式受保护stdin供给，不把密钥写入清单。真实任务在默认权限的独立Docker内使用明确授权的danger-full-access；无需真实模型的宿主烟测使用隔离DSH_HOME和本地mock，只验证配置及模型入口。实际交互请求停止无人协助运行，不自动批准、补答或重试；缺失用量和已开始但缺结果的费用保持未知，提示性美元阈值不充当硬费用上限。

公开提交包含维护者管线、人工合成数据和脱敏的逐次结果/回执。历史六例运行使用旧11功能产物与一次性driver；当前维护管线按12功能版本显式关闭stage-navigation。两者保留不同代码/输入哈希，不把整理后的代码说成旧实验逐字重现或新版已重跑。原始私人Session、profile、凭据、主机路径和其他私人批次仍留本地。

中文网站的文件排序页及公开证据镜像内联展示通过、弱排名和超过40旁路，并链接维护管线。完整行为及验收由[Delta Spec](delta-spec.md)拥有；本记录保存采用该方案的理由、替代方案和实际交付。

## Alternatives

直接复制上游复现包不被采用：其固定参考版本存在逐次/平均报告不一致、重试参数传递缺口和缺失脚本，且使用不同DSH与插件语义。仅复用审阅后的方法及公开接口，不继承其可复现或统计结论。

第一轮同时开启所有功能不被采用：未触发的功能不能计为已测试，也不能据整体结果判断来源。日志、完成核查及文件排序分别配置；只沿用合成测试不能替代真实编码任务的独立测试，反之单个真实任务也不能代表全部功能。

人工解题或自动答复不被采用：会把不同提示与授权引入组间，原生问题及Retry/Cancel按needs-human停止。插件保留既有回退行为，不改变产品协议来制造触发或收益。

## Consequences and limits

排序分数只反映该次路径判断，不等于源码正确性、工具成功或任务成功率。六例中嵌套目标原位13排到5，UI/parser干扰更高；多目标原位26/27排到1/3，parser诱饵排2。嵌套两组均读4个源码；多目标40次源码读取变为5次，开启组另读一次恢复文件。这些仅是固定样例的观察，不可推广为一般准确率、效率或费用收益。

原生glob超过40候选时，即使开关打开也保留原结果。模型别名和服务缓存可变化；一次/条件的小样本不提供通用收益结论。没有记录的字段不能补零，使用量与冻结单价估算不替代服务商账单。

## Verification

- 历史DeepSWE首个完整配对batch6：同题两组normal，独立reward1、F2P56/56、P2P24/24；启用日志组Jev判断0，不提供筛选效果证据。原始失败与费用记录保留在本地，不混入公开glob结果。
- 首个16路径真实glob探针：Jev成功1次，16项分数，目标13→1，完整排序恢复读回；两组文件未变。它与扩大六例分别保存。
- 六例历史真实验证：12/12正常且结构通过，40条主模型usage完整，4次成功Jev判断覆盖69项；16/40完整结果被实际读回，所有fixture未变，最终源码答案人工核验正确。输入锁SHA256为0f864ca6679677a7098e1481120c660893116ab725552aacf5c275a698ecfe0e。峰价估算USD0.026908236，其中Jev USD0.0001785。
- 公开管线交付：DeepSWE40项及selection2项单测通过；新清单prepare/check、12个无模型Pier Job/Trial预检通过。发布版DSH宿主烟测两组各一次mock首请求，23项完整工具schema相同，skill_catalog在、web无、stage关闭，真实provider调用0。未在新版上重跑收费案例。
- 网站：18页构建、相关HTML/Markdown链接和桌面/390px窄屏检查通过；公开字段与历史源值一致，敏感值和暂存格式检查通过。旧编译目录的遗留chunk及CSS差异经清理本任务缓存定位，不纳入产品runtime变化。

## Delivery

[PR #4](https://github.com/luobosibing2/dsh-jev-plugin/pull/4)于2026-10-01 12:37:15（Asia/Shanghai）合入main，合并提交[7e208e0](https://github.com/luobosibing2/dsh-jev-plugin/commit/7e208e040d7f4dae7dcdf292e53a4a1b73c0303f)，原交付commit为9c293e2169ac8a9abc4ad90b697074d14e40b046。远端main已fetch，合并树与已验证交付树相同。

[Pages运行36815964048](https://github.com/luobosibing2/dsh-jev-plugin/actions/runs/36815964048)对应合并提交，build/deploy均success。[文件排序页](https://luobosibing2.github.io/dsh-jev-plugin/features/file-ranking.html)和[公开证据页](https://luobosibing2.github.io/dsh-jev-plugin/evidence/glob-ranking-results.html)均HTTP200，线上字节与已验证本地构建逐字一致；页面保留弱排名、41旁路及历史版本边界。合并后未新增收费实验或重复无变化测试。

本记录、[Alignment](alignment.md)和完整Delta作为一组迁入implemented/testing；原交付时规划文件未进入Git，本次依[Notes维护规则](../../../README.md)公开。未进行Full Spec更新、冷归档、分支删除或worktree清理。
