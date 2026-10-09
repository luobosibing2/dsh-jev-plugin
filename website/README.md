# deepseek-harness-jev 功能介绍站

这是独立的零依赖静态网站。`src/features.mjs` 保存 11 项业务功能、三套判断连接与证据资料，`src/styles.css` 保存页面样式，`build.mjs` 生成首页、独立的判断连接页、功能案例页和公开证据镜像，并复制原理文章页。`dist/` 是构建产物，不提交，也不纳入插件安装包。

```sh
node website/build.mjs
python3 -m http.server 4173 --directory website/dist
```

浏览 `http://localhost:4173/`。构建要求仓库中的公开证据文件存在，包括 `docs/testing/2026-09-27-jev-hooks/public-results.zh-CN.md`、`docs/testing/2026-10-01-glob-ranking/public-results.zh-CN.md`、`docs/testing/2026-10-02-completion-skill/public-results.zh-CN.md` 、`docs/testing/2026-10-05-completion-recovery/public-results.zh-CN.md` 和 `docs/testing/2026-10-07-luna-decisions/public-results.zh-CN.md`。构建先清理 `website/dist/`，再把公开证据转为可在本地和 GitHub Pages 中阅读的纯文本 HTML 页。网站内部链接使用相对路径，可部署到项目子路径。构建不需要安装依赖，也不修改插件运行文件。

“原理与全部功能”文章的 [Markdown 源稿](../docs/explainers/dsh-jev-plugin.md)说明 12 项功能，并包含技能选择的完整输入输出例子。对应的 [HTML 内容源](src/explainers/dsh-jev-plugin.html)随文章提交；构建先核对源稿与 HTML 内嵌的 `#am-source`，只允许末尾换行不同。缺少任一文件、缺少内嵌源稿或内容不一致时，构建失败；一致时原样复制到 `dist/explainers/dsh-jev-plugin.html`。首页与所有生成页的主导航都链接此页，现有 11 个业务案例页保留。

更新文章时，先编辑 Markdown 源稿，再用 `answer-me-with-html` 技能的 `am` CLI 重生成 HTML。下面的 `am` 指该技能提供的命令；它只用于文章维护，网站构建和部署不调用它，也不增加依赖。

```sh
am render docs/explainers/dsh-jev-plugin.md -o website/src/explainers/dsh-jev-plugin.html --no-open
node website/build.mjs
```

重生成后检查文章的图表、输入输出例子和相对链接，再同时提交 Markdown 与 HTML。文章的返回入口指向公开功能网站，Markdown 与 HTML 阅读时均可使用；网站导航使用相对链接，文章发布位置为 `explainers/dsh-jev-plugin.html`。

功能资料中的 `mechanism` 记录触发、交给 Jev 的输入及宿主如何采用，可用 `seams` 列出原生接入点；`cases` 按具名任务记录执行核查、观察和结果解释。案例的 `evidence` 使用资料文件顶部的公开证据 key，`references` 指向仓库公开源码或资料。`homeEvidence` 是概览卡上的一句实测结果。页面生成器兼容旧字段，方便逐项更新资料。

文件排序六例的完整公开记录映射到 `evidence/glob-ranking-results.html`；案例中的后续测试管线入口指向 `bench/selection/README.zh-CN.md`，历史结构化结果指向 `docs/testing/2026-10-01-glob-ranking/results.json`。本地生成页只镜像公开 Markdown，不读取 `.artifacts/` 中的原始 Session、Jev 账本或凭据。

新完成核查诊断映射到 `evidence/completion-recovery-results.html`，旧完成核查与技能实验保留在 `evidence/completion-skill-results.html`。首页优先展示新诊断的真实补做结果，完成核查页仍保留旧长编码零采用及早期“没有新增文件”负例，分开说明脚本初始阶段、真实 Jev 判断、原生补做送达、真实 DeepSeek 后续行动与独立结果。新证据入口链接[方法](../docs/testing/2026-10-05-completion-recovery/README.md)、[结构化结果](../docs/testing/2026-10-05-completion-recovery/results.json)、[回执摘要](../docs/testing/2026-10-05-completion-recovery/receipts.json)和[复跑指南](../bench/completion_skill/README.zh-CN.md)；旧[实验记录](../docs/testing/2026-10-02-completion-skill/README.md)不因新诊断而删除。网站镜像逐字取自公开 Markdown，原始会话与凭据不参与构建。

Jev / Luna 判断连接页为 `connections/luna-decisions.html`，通过所有页面的主导航、首页介绍、验证口径和安装段进入。该页说明 Jev 原连接、Luna / OpenRouter 与 Luna / OpenAI 的端点、请求模型和凭据引用，以及先保存连接、再保存密钥和显式诊断的流程。连接选择不作为第 12 个业务案例页，也不改变原功能机制；现有 11 个页面全部保留。

Luna 公开报告映射到 `evidence/luna-decisions-results.html`，正文逐字取自[公开中文验真报告](../docs/testing/2026-10-07-luna-decisions/public-results.zh-CN.md)。首页优先展示真实 DeepSeek Flash 任务与官方 Luna 的日志省略和单次许可，再分别保留早期固定主模型的两条授权未批准负例、真实任务五路径全得 1 的无区分力结果、OpenRouter 403 访问限制及未新测 cold stage 的边界。文件排序、长日志准入和工作区审批页引用相同公开报告；旧 Jev 案例不删除，也不作为 Luna 效果依据。方法和结构化结果链接仓库公开文件，不把私有验证材料或凭据镜像进网站。
