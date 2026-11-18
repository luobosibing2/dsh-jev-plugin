# 日志省略案例实验对齐

用户明确要求继续实验现有日志省略功能，沿用真实DeepSeek和Jev已有调用授权。范围为output-admission与test-log-admission，先测固定受控日志，不新增产品功能、调低省略阈值、自动补答或据结果重跑。2026-10-02用户追加授权将实际案例写入仓库文档并提交本地commit；公开材料保留真实结果与管线说明，原始Session/凭据/宿主路径继续本地保存。本次未要求推送、合并或网页发布。

实验工作区为隔离工作区（位置未公开），分支codex/jev-log-admission-case-evaluation，从fetch后的origin/main7e208e040d7f4dae7dcdf292e53a4a1b73c0303f创建。旧glob任务已implemented，不覆写其文档或原始数据。新三文件在本目录维护，保持proposed。

采用6个人工日志案例，各baseline/日志组一次，共最多12次；单组120秒、顺序并发1、无自动重试。覆盖短日志旁路、长构建进度/重复warning、普通PASS、真实emitter退出1的失败/慢项/具名保护、重复失败详情规则去重，以及明确完整证据请求的旁路。实际bash非零退出由发布版确认isError=false并附exit标记；基础设施isError=true则旁路。规则去重与Jev语义省略分别计数。

默认general6000/test4000字符门槛、omit概率0.8、等待4秒、净省300字符且10%保持。开启组在12项功能中仅打开两日志功能，其余10项关闭，selection/stage关闭且两组完整工具目录一致。真实任务在默认Docker容器内使用已授权DSH完全权限、无web，主模型DeepSeekFlash/high，Jev1.13.0。正常凭据服务或显式受保护stdin供给，不接触/落盘个人密钥。

本轮USD1为代理选定的累计峰价估算追加阈值，不是硬费用限额；缺用量、实际需人工或服务异常时暂停追加。首次收费前冻结数据、任务、脚本、组件、调度和计价。源规则/原生无费mock预检在冻结前确认覆盖，实际JeV保留或省略都作为结果。区分hook原文、省略提案、后续DSHspill、最终模型可见文本和实际恢复读回，不把原生spill记成Jev收益。

完整要求见[Delta Spec](delta-spec.md)，理由见[Decision](decision.md)。

收费前冻结：正式批次为实验工作区的 `.artifacts/log-admission-suite-v1/batch2`，suite-lock SHA256为`762b7e2dee013886820cacf417f65ffee3522ce92d9c7d4ae7447d062c16a764`。发布版DSH的6场景原生无费mock、12个Pier入口构造及3项局部分析器检查在首次收费前完成。预检发现通用PASS名称`suite`与运行路径重合会触发任务锚定，首次收费前已改人工夹具为独立名称。其余产品条件和默认阈值保持。

真实运行已完成12/12试次，全部正常结束、用量和证据导出完整。短日志/全文需求各自旁路；长general及普通PASS各有一次真实Jev判断但全部omit概率不足0.8，保留原文；失败测试9206→1567字符、重复失败10680→1906字符，分别采用8和7个Jev候选，后者另有4条规则引用。两份保存原文逐字一致，模型原生read分别完整覆盖111/137行。所有保护块、结构化退出状态保持，Host没有再次改写受观察文本。累计峰价估算USD0.031033998；此结果只支持受控日志的功能行为，未证明真实任务成本或效果收益。产物继续本地保存，文档保持proposed，未推送或合并新变更。

公开案例与白名单JSON已写入插件仓库 `docs/testing/2026-10-02-log-admission/`，中英文README和验证说明已补入口。2026-10-02完成本地commit `ec9cd61`（docs(testing): record paired log-admission experiment），分支`codex/jev-log-admission-case-evaluation`；7个相关文件，plugin worktree干净。JSON/源结果逐槽映射、数字与费用独立重算、相对链接、敏感字段及暂存空白检查通过。本次未push、创建PR或发布网页；实际合并前三文件继续proposed。
