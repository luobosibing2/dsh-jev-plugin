# Jev 配对评测与公开测试依据对齐

用户最新授权整理已完成的glob实验及测试管线，做一个commit并推送，后续更新现有网页。公开内容为维护者管线、人工合成案例和脱敏结果；原始运行目录、凭据、用户profile、完整Session、其他私人批次不发布。用户已确认PR实际合并，已核实main合并及Pages部署；网页源码、合并和Pages实际部署分别报告。

复用隔离工作区（位置未公开），分支codex/jev-deepswe-paired-evaluation；已fetch并快进到origin/main d6af739。原主checkout与其他会话工作保留。本组规划在Jev Notes维护，不修改其他会话协调看板或DSH/Mu/Pier产品代码。

历史六例0/1/12/16/40/41候选各关闭/开启一次，12次真实运行全部正常、结构验收通过、fixture未变；Jev4次成功判断共69分，0及41整体旁路。目标原位→排名1→1、2→1、13→5、26→1及27→3，嵌套同名及parser诱饵暴露未稳定排首；最终答案正确。源码读取nested4/4，multi40/5且开启组另读恢复文件1次，不能推广为收益。峰价估算USD0.026908236，不是账单。

历史输入锁0f864ca6679677a7098e1481120c660893116ab725552aacf5c275a698ecfe0e及原插件tar/版本保持不变；实验基于旧版11功能。当前main已有第12项stage-navigation，公开管线显式关闭它，不能声称原实验测了新版或新脚本逐字重现旧driver。默认候选40/显示12、grep旁路、无web、独立Docker及danger-full-access保持；无人工自动答复、自动重跑或新增收费验证。

公开管线接受显式manifest，可在新检出准备/检查/无模型入口预检并逐槽运行/汇总，不依赖私有batch6或本机路径。使用正常DSH credentials或显式受保护stdin供给。新增合成案例及真值预先锁定；缺usage、服务异常或需人工时暂停，预算为追加估算控制，不保证硬美元上限。

网页沿用现有纯中文文件排序详情、首页证据一句及公开证据镜像，内联完整结果、弱排名和41旁路，并链接公开报告与管线；不重设计其他功能。Sol负责代码和网页，Luna整理公开元数据，主代理审查并唯一执行commit/push。已按实际合并结果改写Decision并整组迁入implemented；不更新Full Spec或清理工作区。

完整要求见[Delta Spec](delta-spec.md)，理由与结果见[Decision](decision.md)。

当前交付：PR #4已合入main，合并提交7e208e040d7f4dae7dcdf292e53a4a1b73c0303f，时间2026-10-01 12:37:15（Asia/Shanghai）。Pages运行36815964048的build/deploy均成功；线上文件排序与公开证据页HTTP200，字节与已验证构建完全相同。状态implemented，原实验与维护管线的证据边界保持，未新增收费实验。
