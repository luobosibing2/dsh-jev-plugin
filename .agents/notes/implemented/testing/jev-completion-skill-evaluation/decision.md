# Decision: 完成核查与技能选择量化实验

Status: implemented

## Decision

采用互不同时启用的完成核查与技能选择实验，分别记录Jev参与、判断能否采用、实际动作和独立任务结果。维护入口包含`initial-26`、`coding-followup-4`、`skill-repository-8`，从显式资源清单创建新批次，记录源码、产品产物和输入身份，保留失败、中止及未开始槽。产品源码与默认参数未因本次归档改变。完整要求由[Delta Spec](delta-spec.md)拥有。

固定完成记录使用脚本主模型与真实Jev，覆盖普通真实主模型可能不自然出现的遗漏；实际编码和技能任务使用真实DeepSeek。固定脚本的后续动作不能作为自主修复率。技能选择除排名外还核对正文加载、源码读取和最终事实，避免把目录压缩当作任务收益。

## Results

首批26槽有26份结果，25槽通过结构与用量完整性门槛。固定短记录首判6/6，三个遗漏各补做一次；缺文件例补齐后Jev仍判遗漏，保留为二判负结果。技能两组各6/6任务事实通过，9/9所需项进入前五；全无关低分仍发布五项，近名回复瑕疵保留。真实编码两组独立F2P56/56、P2P24/24；开启组耗尽600秒预算，无正常完成判断，第149步费用未知。

编码后续计划AB/BA四槽、Agent1800秒，实际运行两槽。baseline正常结束；开启组独立代码测试通过，且Jev有真实回答，但24000字符预算裁掉296条消息，保留34条且原始用户要求缺失。`completeEvidence=false`使回答不可采用，attempt failed/UNDETERMINED，operation cancelled，补做0次；原生Retry/Cancel被评测交互guard捕获后中止。批次保持halted，第3/4槽未开始。该失败不是HTTP、凭据或typed选项错误。

技能后续8槽全部正常结束。四个开启组各评分24项，6次所需技能入选机会全部进入前五。目录摘要累计96→20、字符9084→4219；两组各加载6次技能正文、确认24次源码read，题面事实与引用均4/4。费用差正负混合，未见稳定成本、读取或任务正确率增益。未展示store实现的附带推断单列，事实通过率不等于整段回复完全可证。

完整25个首批槽估算USD0.210807618，首批已记录部分合计USD0.440568054，完整总费用未知。后续技能费用完整USD0.031414584；编码开启组按异常结束规则仍未标整槽费用完整，后续可核算部分合计USD0.544360938，非完整账单。公共[中文报告](../../../../../docs/testing/2026-10-02-completion-skill/public-results.zh-CN.md)、结果白名单和回执摘要保留不同条件、未知费用、raw与采用的区别。

## Verification

维护包在不含旧artifact源码的干净Git副本中，依赖离线安装成功，三个场景prepare/check通过26/4/8槽，11项无密钥单测通过。初始完成2槽与基础技能6槽原生probe在较早维护快照通过；最终源码24技能probe4/4通过且运行后锁检查通过。局部修复了凭据启动器迁移后的根目录定位，以及mock就绪检查在pid创建前误判进程退出的竞态；竞态用受控屏障回归覆盖，保留原10秒上限和零重试。凭据启动器只做语法/根定位验证，本次维护交付没有收费重跑。

38个计划槽的190项公开状态字段及费用字段与原报告核对，来源SHA、74个本地链接、55个暂存文件的范围/换行/敏感内容检查及git diff --cached --check通过。原始锁和停止状态未变。维护包49文件汇总SHA-256为`eebda1a3bfd00e529666c5ad573b9a6f01a66fff3db5978b3aecf00f74c9caf0`。

网页构建生成1个首页、11个功能页和7个证据页。19页站内链接有效，新镜像与公开Markdown逐字一致，页面数字与JSON核对。1280×720及390×844浏览检查覆盖首页、两个功能页和实验报告；手机宽度无横向溢出。JavaScript语法、差异和暂存范围/敏感内容检查通过。没有新CI checks报告，不能把本地检查写成CI通过。

## Delivery

实验本地commit `21a2db9bce426625a7a78e023f5ca762af320bdb`已通过[MR #6](https://github.com/luobosibing2/dsh-jev-plugin/pull/6)合入远端main，合并commit为`39f880e838df3a6df13b221e1fd66fde39763eae`。已核对MR状态MERGED且原commit是origin/main祖先。主线合并日期为2026-10-03。

网页更新commit `e7c986114f2b9d1319e6b0b292edeb0039f4e196`通过[PR #7](https://github.com/luobosibing2/dsh-jev-plugin/pull/7)于2026-10-03 12:20:35 UTC合入main，合并提交为`a326a4460a7fe64cdb509f1970babf2953bb5aa7`。它更新首页和两项功能案例、公开报告镜像、canonical仓库链接与Pages路径触发。2026-10-25公开整理时重新核对GitHub状态为MERGED；本次没有新增Pages部署或线上内容验收，原有本地网页检查保持原范围。

本机资源清单位于插件工作区`.artifacts/completion-skill-resources/resources.json`；DeepSWE/Pier为显式外部资源，Node与插件tar及DSH锁在同目录，均未提交。原始Session、密钥、个人路径和私有构建产物不入插件Git提交；规划文件在原交付时仅本地保留，本次按[Notes维护规则](../../../README.md)公开。[复跑指南](../../../../../bench/completion_skill/README.zh-CN.md)拥有重跑操作与依赖前提。实验代码已合并且网页MR交付完成，因此整组文档转入implemented；网页MR与线上部署仍单独记录状态。
