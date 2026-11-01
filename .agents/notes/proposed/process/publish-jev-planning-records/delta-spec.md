# Jev 规划文档公开与默认 Git 跟踪增量规格

本规格覆盖 Jev 文档公开和通用 Superpowers 规划默认值两个相关交付。状态为 proposed：公开分支尚未确认合并；通用默认值已完成本地提交、安装及验证。实际结果见 [decision.md](decision.md)。

## 目标与范围

公开用户明确要求的全部 Jev 三文件规划记录，使后续 Git 规划默认留下可审查的版本记录。规划工具和 Skill 的行为须一致，不能只删除说明文字而继续强制 Git 忽略。

Jev 发布分支 `codex/publish-jev-planning-records`，直接基于 `49d0994d8454162138ad8b13aa4cc235e76143f3`。Superpowers 分支 `codex/version-feature-planning-documents`，直接基于当前安装对应的 `57b575cf276cdfc1b5602d43f7bb0c7d42fec75f`。DSH 源码不改，旧 Jev 规划目录只作为本轮导入来源。

## ADDED Requirements

- **REQ-DOC-001：公开全部明确属于 Jev 的既有三文件记录。** 纳入原 DSH Notes 中十组明确 Jev 记录及 Jev 自身的 `jev-native-spill-budget`，每组保留 alignment、完整 Delta 和 decision 的职责与相互链接。新发布任务本身也纳入版本记录。ChatGPT OAuth 登录规划属于 DSH，不纳入 Jev。
  - 验收：历史十一组共三十三个文件及本次三文件均能被正常暂存；没有遗漏某一组或误纳入 OAuth 目录。
- **REQ-DOC-002：公开版本可在干净 checkout 中阅读。** 修复导入后相对路径，将代码依据指向仓库文件或明确版本的公开源；去除个人主目录、临时 worktree 和只在本机存在的链接。私有原始实验、凭据、profile、个人截图和原始会话不得被导入。保留真实结果、失败、未交付状态和证据限制，不能把本地路径换成不存在的公开证据。
  - 验收：内部链接能解析，公开文件不含个人绝对路径或对本地 worktree 的依赖；原数据不可公开时明确写出该边界；数值及历史结论与原记录一致。
- **REQ-WF-001：文档跟踪与 Git 操作由 root 负责。** 三文件继续以 primary checkout 为工作权威，root 在功能提交或独立文档提交前将同一份权威内容纳入任务分支，不能形成两套独立编辑的规格。实际合并后，decision 按交付实况改写及整组生命周期移动也须保存为 Git 变更；未经合并授权不得为收尾自行合并。
  - 验收：Skill 明确上述提交职责；Hook 不执行 git add、commit、push，不自动决定合并或归档；关联元数据仍只在本地 Git config。
- **REQ-WF-002：新的默认值在本机未来会话实际生效。** 更新权威源码、必要测试与插件版本，从本次精确提交导出干净本地发布，通过受支持的 marketplace 和 plugin 安装命令更新。不得用 dirty 主 checkout 安装或直接修改 cache 冒充安装。
  - 验收：安装器报告新版本 enabled，发布目录与安装 cache 对应文件一致，新安装的 SessionStart/Stop 使用新规则；既有会话已注入的旧文案不声称被即时替换。

## MODIFIED Requirements

- **REQ-WF-003：Git feature 文档默认纳入版本控制。**
  - 之前：bind 拒绝已跟踪文档，自动写入四生命周期精确排除；Stop 只保存到未跟踪且已忽略的文件；说明要求三文件永久 local-only。
  - 现在：正常未忽略及已跟踪的 feature 文档均可显式绑定和保存。bind 不再添加忽略规则；仅对当前明确绑定的 feature 撤销 helper 原先生成的精确生命周期排除，保留其他排除项。不全局扫描或取消其他任务历史私有目录的忽略。仓库自身的忽略规则若仍阻止默认跟踪，应给出具体说明，不能假装成功改为默认跟踪或自动覆盖用户其他规则。
  - 验收：新 feature 在没有配置文件的干净仓库可正常 git add；已有 tracked feature 可重新绑定，Stop 能更新 proposed Delta；当前 feature 的旧精确排除被清除，其他目录排除保持；普通仓库规则冲突可诊断。
- **REQ-DOC-003：Jev 的规则允许规划文档进入代码历史。**
  - 之前：AGENTS 明确规划记录保持私有，gitignore 忽略 proposed、implemented、archived。
  - 现在：Jev Notes 默认随 Git 维护，不带入发布安装包；本次授权的路径撤销阻止跟踪的规则。历史来源是导入材料，公开记录以 Jev 仓库中的版本为维护入口；本次不删除 DSH 原始导入材料或改其产品源码。
  - 验收：Jev AGENTS、Notes 说明及 Git 状态一致；文档可正常暂存；package files 仍排除 Notes，公开不等于加入运行时安装包。

## REMOVED Requirements

取消 Git feature 三文件必须 local-only、必须 ignored、不得 tracked 的默认限制，以及“合并后文档移动无需保存 Git 变更”的说明。非 Git 提醒行为不变。不移除既有内容安全、绑定及生命周期保护。

## 保持不变的行为

继续使用一个 feature 目录下的 alignment、delta-spec、decision；完整 Delta 保留十二节及可判定验收。显式任务关联、类别与生命周期冲突检查、路径越界和外部 symlink 防护、非 proposed 不被 Stop 覆盖、实际 merge 才改 implemented 的规则不变。Full Spec 仍须用户明确调用。不得新增工作流控制器、自动提交器、索引服务或后台 MR watcher。

## 输入、默认值、顺序与优先级

本次用户选择覆盖 local-only 旧默认。后续 Git 规划默认跟踪文档；用户明确要求私有或不提交时继续遵守，不因此自动公开旧材料。先核查来源和真实状态，再整理可公开文本，做最小必要检查后提交；不重跑历史付费实验。

已有部署的 Superpowers 对应源码领先远端 Slim 分支八条、领先默认 main 十八条。本次只在该精确基线上创建独立本地提交并更新本机安装，不推送这些既有历史；Jev 文档的公开 MR 单独交付。

## 失败与回退

不能确认 Jev 归属的文档先由 root 按材料判断，不按名称相似推定。已合并状态用仓库或 GitHub 当前证据确认；没有交付证据的历史记录保留原生命周期并说明范围。缺失公开原始材料不制造链接，也不抹除验证限制。

遇到跟踪与忽略冲突时报告具体规则，不通过全局取消忽略或批量 force-add 解决。安装或市场源更新失败时保留旧发布目录和原安装信息，报告实际生效状态；不得宣称仅源码修改就已影响未来会话。

## 端到端传递

历史三文件来源与状态核查 → Jev 分支中的可移植 Notes → 正常 Git 暂存、提交、推送与独立 MR。通用源码默认值 → bind/Stop/SessionStart 与 Skills 同步 → 针对真实 Git 行为测试 → 精确提交的干净本地发布 → 官方插件安装 → 新会话读取新规则。两条交付不混淆源仓库及授权。

## 对外契约

Jev 新增可读规划记录与 Notes 维护说明，不改变产品代码或模型行为。Superpowers Git feature 文档的默认可跟踪性改变；命令入口和显式绑定字段保持现有用途，本地 session/worktree 关联不公开。公共文档不能包含个人绝对路径和本机私有证据入口。

## 验收示例

| 场景 | 给定 | 当 | 则 | 覆盖需求 |
| --- | --- | --- | --- | --- |
| 全部 Jev 历史 | DSH 十组明确 Jev 与本次 Spill 一组 | 导入 | 十一组齐备，OAuth 不在提交 | REQ-DOC-001 |
| 可移植阅读 | 文档原有本地代码或证据链接 | 干净 checkout 检查 | 仓库链接有效，私有数据边界明确 | REQ-DOC-002 |
| 真实已合并状态 | PR48 已 merge、CI 成功 | 整理 | decision 为实况、整组 implemented，保留最终 Delta | REQ-DOC-001、REQ-DOC-002 |
| 仅历史本地结果 | 有实验输出但没有当前 merge 依据 | 整理 | 不凭输出升级为已交付，不重跑付费实验 | REQ-DOC-002 |
| 新 Git feature | 无文档忽略项 | bind 后写三文件并 git add | 可正常暂存，不新增 exclude | REQ-WF-003 |
| 已跟踪 proposed | feature 已在 Git 内 | 重新 bind、Stop 保存完整 Delta | 成功更新，不被 tracked 限制拒绝 | REQ-WF-003 |
| 旧精确 exclude | 当前 feature 四条旧规则与无关规则同时存在 | bind | 只清理当前 feature 四条，保留无关规则 | REQ-WF-003 |
| 仓库另有忽略 | 普通 gitignore 阻止 Notes 跟踪 | bind/保存 | 报告冲突，不自动覆盖普通规则 | REQ-WF-003 |
| 其他生命周期 | implemented 或 rejected 目录 | Stop | 不覆盖已交付或已拒绝 Delta | REQ-WF-003 |
| 非 Git | 原 session reminder | 使用提醒/保存 | 保持原行为 | REQ-WF-003 |
| 权威与提交 | primary 权威与任务 worktree 分离 | root 提交与合并后收尾 | 提交同一份内容与真实移动，Hook 不自动 Git 写入 | REQ-WF-001 |
| 安装新默认 | 源码验证及提交完成 | 官方本地插件更新 | 新版本生效且干净发布/cache 一致 | REQ-WF-002 |
| Jev 安装包 | Notes 纳入 Git | 检查 package files | Notes 不进入安装包，产品运行文件不变 | REQ-DOC-003 |

## 非目标

不公开原始 Session、凭据、profile、个人截图或付费实验原始数据；不改 DSH 产品代码；不默认提交其他项目旧私有材料；不推送 Superpowers 已有八条未发布历史；不合并 MR、发布 npm 版本、删除旧安装 cache 或清理他人工作区。不新增通用搜索索引、自动同步守护进程或 Hook Git 提交控制。

## 决策闭合

- 已确认：用户选择公开所有 Jev 规划材料及将未来默认改为纳入 Git；原本仅本地保留政策被本次选择覆盖。提交发布 Jev 文档及本机默认值修改已有授权。
- 代码事实：Jev 有一组已合并 Spill 记录；DSH 十组明确 Jev 及一组 DSH OAuth；三文件齐备，均被忽略。Superpowers 的 bind、Stop、SessionStart、Skill 与初始化参考共同要求 local-only；当前安装与源码 57b575c 相同，但远端落后且含无关历史。PR48 merge 为 49d0994，两项 CI 成功。
- 未决问题：无阻止当前范围实施的问题。若另外要把 Superpowers 源码公开到远端，须先单独确定那批既有历史的交付范围，不将其混入本次 Jev MR。
