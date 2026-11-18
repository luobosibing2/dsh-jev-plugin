# Jev / Luna Decisions 当前对齐

## 已确认方向

插件支持Jev与Luna Decisions二选一；Luna支持OpenAI官方与OpenRouter Decisions API。主模型、原业务题目、功能开关、阈值、权限机制与原失败流程保持原行为。两API由共用判断服务直接转换，完整输入与真实原始响应分别保留，不用普通生成接口替代Decisions。

实施对象为独立仓库 `deepseek-harness-jev`、包 `@dsh-jev/plugin`；工作区为隔离工作区（位置未公开），分支 `codex/jev-luna-decision-backend`，基线 `origin/main@3ee4fb1`。本组功能记录不属于DSH产品源码修改。

## 当前交付授权

用户最新要求将接入与验真写入文档、代码合入主分支，并调整网页写入实验结果。官网为本仓库GitHub Pages，远端main自动部署；本轮通过PR合入 `luobosibing2/dsh-jev-plugin/main` 并确认在线内容。独立仓库本地main在确认远端合并后仅快进同步。主checkout当前干净，不重置或覆盖其他工作区。

公开文档只包含精简的行为说明、实验条件、计数、独立结果和边界；原始Session、凭据、本机profile、个人截图及API原始捕获保留私有，不发布。网页保留历史Jev实验，新增Luna连接与证据入口，不将Luna连接算作新业务功能。两次受控审批未达预期、排序没有改善及日志格式旁路均保留。

产品实现、300项本地测试、构建、实际安装与有限真实任务验证已完成；本轮不重复付费调用，新增文档和网站完成构建及浏览器验收后发布。PR #11已实际合并，main为79cdf65；GitHub Pages对应部署成功。本组已按交付事实重写，并整组移至implemented。日常用户profile、已有凭据、其他分支/PR、累计Full Spec不在本轮修改范围。不删除分支或清理实验工作区。

## 必须保留的验真边界

OpenAI官方固定诊断与受控样例6次返回200，两个明确授权审批样例仍为unauthorized。后续真实DeepSeek Flash两个任务及首Session续验，14主模型/3Luna请求均200；真实160模块构建、sum12880、退款3/3、日志8407→2122及原生spill独立回读、一次approve→allowed-once→实际文件已观察到。五候选均得1，原序未变。新审批成功不确定先前拒绝原因或建立稳定性，固定可丢弃任务不代表自然任务收益。

OpenRouter真实请求一次403服务条款限制后，用户要求停止处理该渠道；协议与安装支持保留，但没有真实成功样例。GUI cold stage及未触发功能没有新的真实任务覆盖。完整行为由 [Delta Spec](delta-spec.md)定义，方案理由及实际交付状态见 [决策记录](decision.md)。

## 当前未决问题

无待用户决定的范围问题。PR状态MERGED、远端与本地main为79cdf65、对应Pages部署success；本组状态implemented，公开文档及在线内容已经核对。
