import { readFile, mkdir, writeFile, copyFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { evidence, features, groups, judgmentConnections, lunaCases } from './src/features.mjs';

const website = dirname(fileURLToPath(import.meta.url));
const repository = resolve(website, '..');
const output = join(website, 'dist');
const github = 'https://github.com/luobosibing2/dsh-jev-plugin';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function page({ title, description, depth = '', body }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="description" content="${escapeHtml(`deepseek-harness-jev 是 DeepSeek Harness（DSH）的独立社区插件，可选 Jev / System One 或 Luna Decisions 判断。${description}`)}">
  <title>${escapeHtml(title)} · deepseek-harness-jev｜DeepSeek Harness（DSH）与 Jev / Luna Decisions</title>
  <link rel="stylesheet" href="${depth}assets/site.css">
</head>
<body>
  <a class="skip-link" href="#main">跳到正文</a>
  <header class="site-header"><div class="shell site-header__inner">
    <a class="brand" href="${depth}index.html" aria-label="deepseek-harness-jev 首页"><span class="brand__glyph" aria-hidden="true">d<span>/</span>j</span><span>deepseek-harness-jev</span></a>
    <nav class="top-nav" aria-label="主导航"><a href="${depth}index.html#features">功能与案例</a><a href="${depth}connections/luna-decisions.html">Jev / Luna 连接</a><a href="${depth}index.html#evidence">验证口径</a><a href="${depth}index.html#install">安装</a><a href="${github}" target="_blank" rel="noopener noreferrer">仓库 ↗</a></nav>
  </div></header>
  <main id="main">${body}</main>
  <footer class="site-footer"><div class="shell site-footer__inner"><p>独立社区项目 · 内容来自公开测试记录，不代表普遍语义正确性。</p><a href="${github}/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">MIT 许可证 ↗</a></div></footer>
</body>
</html>`;
}

function status(feature) {
  return `<span class="status status--${escapeHtml(feature.tone)}">${escapeHtml(feature.status)}</span>`;
}

function featureHref(feature, depth = '') {
  return `${depth}features/${feature.slug}.html`;
}

function homePage() {
  const featureGroups = groups.map((group) => {
    const cards = features.filter((feature) => feature.group === group.id).map((feature) => `<a class="feature-card" href="${featureHref(feature)}"><span class="feature-card__meta">${status(feature)}<span aria-hidden="true">↗</span></span><h4>${escapeHtml(feature.name)}</h4><p>${escapeHtml(feature.summary)}</p><span class="feature-card__evidence">${escapeHtml(feature.homeEvidence ?? feature.observed?.[0] ?? '查看测试结果与边界。')}</span></a>`).join('');
    return `<section class="feature-group" aria-labelledby="group-${group.id}"><div class="feature-group__heading"><h3 id="group-${group.id}">${escapeHtml(group.title)}</h3><p>${escapeHtml(group.description)}</p></div><div class="feature-grid">${cards}</div></section>`;
  }).join('');
  const body = `
  <section class="hero shell" aria-labelledby="hero-title"><div class="hero__copy"><p class="eyebrow">deepseek-harness-jev / 功能与实测</p><h1 id="hero-title">DSH 继续执行。<br>Jev / Luna 提供判断。</h1><p class="hero__lead">主 Agent 负责规划、工具调用与回答；所选 Jev / System One 或 Luna Decisions 在已启用的 DSH 原生扩展点提供判断。Luna 可选 OpenAI 或 OpenRouter API；本页保留 11 个业务案例页，功能分别开启，默认全部关闭。</p><a class="text-link" href="connections/luna-decisions.html">Jev / Luna 判断连接与验真 <span aria-hidden="true">↗</span></a> <a class="text-link" href="#features">查看业务案例 <span aria-hidden="true">↓</span></a></div><aside class="hook-trace" aria-labelledby="hook-trace-title"><div class="hook-trace__heading"><span>源码接入点</span><h2 id="hook-trace-title">典型的三处判断</h2></div><ul><li><code>agent/pre-step</code><span>发布技能目录前，整理技能摘要。</span><a href="${github}/blob/main/packages/jev/src/selection.ts" target="_blank" rel="noopener noreferrer" aria-label="查看技能选择实现">↗</a></li><li><code>tools/post-execute</code><span>命令返回后，评估可省略的日志。</span><a href="${github}/blob/main/packages/jev/src/output-admission.ts" target="_blank" rel="noopener noreferrer" aria-label="查看日志准入实现">↗</a></li><li><code>approval/request</code><span>适用的单次提权请求进入原生审批。</span><a href="${github}/blob/main/packages/jev/src/workspace-approval.ts" target="_blank" rel="noopener noreferrer" aria-label="查看工作区审批实现">↗</a></li></ul><p>这些是三个独立例子，并非任务必须依次经过的步骤。</p></aside></section>
  <section class="flow shell" aria-labelledby="flow-title"><div class="section-heading"><p class="eyebrow">工作方式</p><h2 id="flow-title">一次判断放在原生流程之内。</h2></div><ol class="flow__steps"><li><span>DSH 主 Agent</span><small>规划与调用工具</small></li><li><span>原生扩展点</span><small>只接入已启用功能</small></li><li><span>所选判断模型</span><small>Jev / Luna Decisions</small></li><li><span>DSH 记录</span><small>核对交付与实际执行</small></li></ol><p class="flow__note">插件不替代主模型，也不修改 DSH 宿主源码。切换连接保留原功能开关、判断题、阈值与权限机制；判断成功和操作成功分别记录。</p></section>
  <section class="evidence-overview shell" id="evidence" aria-labelledby="evidence-title"><div class="section-heading"><p class="eyebrow">指定场景的实测</p><h2 id="evidence-title">数字、动作和结果一起看。</h2><p>优先查看官方 Luna 的有限真实任务链，历史 Jev 实验继续保留。每条结论注明实际模型和主模型是否受控；这些结果只适用于所测条件。</p></div><div class="observation-grid"><a href="connections/luna-decisions.html#real-results" class="observation"><span>官方 Luna · 真实 DeepSeek Flash 任务与同会话续验</span><strong>8,407 → 2,122</strong><p>构建日志净减 74.76%，实际后续主模型收到缩短文本；验收者逐字回读原生 spill。160 模块、sum 12880、哈希及测试 3/3 均核对。</p><span class="observation__link">查看真实任务与日志证据 ↗</span></a><a href="connections/luna-decisions.html#approval-results" class="observation observation--negative"><span>官方 Luna · 审批成功与保留负例</span><strong>一次 allowed-once</strong><p>真实任务的 approve 0.68 经原生许可完成准确写入，无人工和长期模式变化；此前两个受控授权样例均未自动批准，尚未证明审批稳定。</p><span class="observation__link">查看审批结果与边界 ↗</span></a><a href="features/completion-check.html" class="observation"><span>历史 Jev · 完成核查 / 三类脚本种错</span><strong>6/6 真实补做</strong><p>开启组由真实 Jev 判断，原生补做入模后由 DeepSeek 自主处理，三类固定错误的核心要求各 2/2 满足。</p><span class="observation__link">查看完成核查案例 ↗</span></a><a href="features/skill-selection.html" class="observation"><span>24 技能仓库调查 · 真实 DeepSeek 与 Jev</span><strong>96 → 20</strong><p>目录摘要累计减少；关闭与开启组各读 24 次源码、加载 6 次所需技能，题面事实均 4/4。</p><span class="observation__link">查看技能选择案例 ↗</span></a><a href="features/long-log-admission.html" class="observation"><span>历史 Jev · 单次构建日志</span><strong>75.7%</strong><p>交给 Agent 的文本从 8,510 缩至 2,072 字符，产物哈希保留。没有测得平均节省。</p><span class="observation__link">查看日志准入案例 ↗</span></a><a href="features/completion-check.html" class="observation"><span>历史 Jev · 完成核查 / 准确报告对照</span><strong>2/2 无误补做</strong><p>同类Python测试实际生成缓存；开启组准确报告后，Jev两次均判complete，零原生补做、零真实主模型派发。</p><span class="observation__link">查看准确对照 ↗</span></a></div><p class="evidence-overview__note">阅读口径：官方 Luna 两个真实主模型任务及同会话续验共 14 次主模型请求、3 次 Decisions，全部 HTTP 200；前轮固定主模型的 6 次官方调用另记。OpenRouter 首次真实诊断因访问限制返回 403，已停止该渠道，未完成成功验真。未新测 GUI cold stage 或全部 12 项功能，费用金额未返回，也未证明自然任务平均收益。<a href="evidence/luna-decisions-results.html">Luna 公开验真 ↗</a> <a href="connections/luna-decisions.html">三套连接与证据口径 ↗</a> 历史 Jev 的固定种错补做与长轨迹零采用继续保留：<a href="evidence/completion-recovery-results.html">新实验报告 ↗</a> <a href="evidence/completion-skill-results.html">历史报告 ↗</a> <a href="${github}/blob/main/docs/testing/2026-10-05-completion-recovery/results.json" target="_blank" rel="noopener noreferrer">结构化结果 ↗</a> <a href="${github}/blob/main/bench/completion_skill/README.zh-CN.md" target="_blank" rel="noopener noreferrer">复跑指南 ↗</a> <a href="evidence/validation.html">验证范围 ↗</a></p></section>
  <section class="catalog shell" id="features" aria-labelledby="features-title"><div class="section-heading"><p class="eyebrow">本页介绍的 11 项功能</p><h2 id="features-title">按用途阅读，再进入具体案例。</h2><p>每页说明触发时机、所选判断模型收到什么、宿主怎样采用判断，以及按实际模型分别记录的测试结果。Luna 连接入口单独展示，不增加业务功能数量。</p></div>${featureGroups}</section>
  <section class="install shell" id="install" aria-labelledby="install-title"><div><p class="eyebrow">开始使用</p><h2 id="install-title">在 DSH Web 中安装。</h2><p>已针对 DSH 0.1.7-rc.2 Web 验证。在「插件」→「添加插件」中粘贴仓库地址，安装并启用插件；之后在 Jev 页面选择判断模型 Jev / Luna，Luna 再选择 OpenAI / OpenRouter。先保存连接，再保存该引用的 API Key、显式测试连接，最后按需开启功能。主模型由 DSH 单独配置，其他功能机制保持原值。</p><p class="install__note">本页介绍的功能在安装后仍默认关闭。<a href="connections/luna-decisions.html#setup">查看三套连接的地址、模型与凭据引用 ↗</a>。历史 v0.1.0 安装包不含较新的日志筛选与 Luna 接入。</p></div><div class="install__address"><span>仓库地址</span><code>${github}</code><a href="${github}/blob/main/README.zh-CN.md#网页端安装推荐" target="_blank" rel="noopener noreferrer">阅读完整安装说明 ↗</a></div></section>`;
  return page({ title: '功能与实测结果', description: '本页介绍的 11 项功能的触发机制、具体测试案例、实际结果与限制。', body });
}

function referenceLinks(references = []) {
  return references.map((reference) => `<a href="${github}/blob/main/${reference.file}${reference.anchor ?? ''}" target="_blank" rel="noopener noreferrer">${escapeHtml(reference.title)} ↗</a>`).join('');
}

function evidenceLinks(keys = []) {
  return keys.filter((key) => evidence[key]).map((key) => `<a href="../evidence/${evidence[key].slug}.html">${escapeHtml(evidence[key].title)} ↗</a>`).join('');
}

function mechanismFor(feature) {
  return feature.mechanism ?? {
    trigger: feature.scenarios?.[0] ?? '见公开功能说明。',
    input: feature.intro,
    handling: feature.summary,
    refs: feature.references ?? [],
  };
}

function casesFor(feature) {
  return feature.cases?.length ? feature.cases : [{
    kind: '公开验收', title: `${feature.name}的已记录结果`,
    task: feature.scenarios?.join(' '),
    probe: '对照工具结果、会话记录与判断记录。',
    result: feature.observed?.join(' '),
    reading: feature.impact,
    evidence: feature.sources,
    references: feature.references,
  }];
}

function mechanismSection(feature) {
  const mechanism = mechanismFor(feature);
  const seams = mechanism.seams?.length ? `<div class="mechanism__seams"><span>原生接入点</span><ul>${mechanism.seams.map((seam) => `<li><code>${escapeHtml(seam)}</code></li>`).join('')}</ul></div>` : '';
  return `<section class="mechanism" aria-labelledby="mechanism-title"><div class="section-heading"><p class="eyebrow">接入方式</p><h2 id="mechanism-title">这项判断如何进入任务</h2></div>${seams}<dl class="mechanism__steps"><div><dt>触发</dt><dd>${escapeHtml(mechanism.trigger)}</dd></div><div><dt>送给所选判断模型</dt><dd>${escapeHtml(mechanism.input)}</dd></div><div><dt>如何采用</dt><dd>${escapeHtml(mechanism.handling)}</dd></div></dl>${mechanism.refs?.length ? `<p class="mechanism__refs">实现依据：${referenceLinks(mechanism.refs)}</p>` : ''}</section>`;
}

function caseSection(testCase, feature, index, featuredIndex) {
  const links = [evidenceLinks(testCase.evidence ?? (index === 0 ? feature.sources : [])), referenceLinks(testCase.references ?? (index === 0 ? feature.references : []))].filter(Boolean).join('');
  return `<section class="case${index === featuredIndex ? ' case--lead' : ''}" aria-labelledby="case-${index}"><div class="case__heading"><span class="case__kind">${escapeHtml(testCase.kind ?? '测试案例')}</span><h2 id="case-${index}">${escapeHtml(testCase.title)}</h2></div><p class="case__task">${escapeHtml(testCase.task)}</p><p class="case__probe"><span>执行与核查</span>${escapeHtml(testCase.probe)}</p><div class="case__finding"><span>实际观察</span><p>${escapeHtml(testCase.result)}${links ? `<span class="case__sources">证据：${links}</span>` : ''}</p></div>${testCase.reading ? `<p class="case__reading">${escapeHtml(testCase.reading)}</p>` : ''}</section>`;
}

function detailPage(feature) {
  const group = groups.find((candidate) => candidate.id === feature.group);
  const testCases = casesFor(feature);
  const featuredIndex = testCases.findIndex((testCase) => testCase.kind?.includes('真实'));
  const limitReferences = feature.limitReferences?.length ? `<p class="detail-limits__refs">历史依据：${referenceLinks(feature.limitReferences)}</p>` : '';
  const limits = feature.limits?.length ? `<div class="detail-limits"><h2>这些结果的边界</h2><ul>${feature.limits.map((limit) => `<li>${escapeHtml(limit)}</li>`).join('')}</ul>${limitReferences}</div>` : '';
  const next = features[features.indexOf(feature) + 1];
  const body = `<div class="detail shell"><nav class="breadcrumbs" aria-label="当前位置"><a href="../index.html#features">本页 11 项功能</a><span aria-hidden="true">/</span><span>${escapeHtml(group.title)}</span><span aria-hidden="true">/</span><span aria-current="page">${escapeHtml(feature.name)}</span></nav><article><header class="detail__header"><div class="detail__meta"><span>${escapeHtml(group.title)}</span>${status(feature)}</div><h1>${escapeHtml(feature.name)}</h1><p class="detail__summary">${escapeHtml(feature.summary)}</p><p class="detail__intro">${escapeHtml(feature.intro)}</p><p class="case__reading">该功能使用当前保存的 Jev 或 Luna Decisions 连接；案例按实际模型单独标注。切换连接保留原功能机制。<a href="../connections/luna-decisions.html">判断连接与验真 ↗</a></p></header>${mechanismSection(feature)}<div class="case-list">${testCases.map((testCase, index) => caseSection(testCase, feature, index, featuredIndex)).join('')}${limits}</div><nav class="detail-next" aria-label="继续阅读"><a href="../index.html#features">← 返回功能概览</a>${next ? `<a href="${next.slug}.html">下一项：${escapeHtml(next.name)} →</a>` : ''}</nav></article></div>`;
  return page({ title: feature.name, description: `${feature.name}：${feature.summary}查看接入方式、测试案例与实际结果。`, depth: '../', body });
}


function connectionsPage() {
  const rows = judgmentConnections.map((connection) => `<tr><th scope="row">${escapeHtml(connection.name)}</th><td><code>${escapeHtml(connection.endpoint)}</code></td><td><code>${escapeHtml(connection.model)}</code></td><td><code>${escapeHtml(connection.credentialRef)}</code></td></tr>`).join('');
  const cases = [lunaCases.realBuild, lunaCases.realApproval, lunaCases.realRanking, lunaCases.controlledApproval, lunaCases.controlledLogs];
  const body = `<div class="detail shell"><nav class="breadcrumbs" aria-label="当前位置"><a href="../index.html">功能与实测</a><span aria-hidden="true">/</span><span aria-current="page">判断连接与验真</span></nav><article>
  <header class="detail__header"><div class="detail__meta"><span>判断模型与 API</span><span class="status status--observed">官方有限真实任务已验</span></div><h1>Jev / Luna 判断连接与验真</h1><p class="detail__summary">官方 Luna 已观察到真实日志省略和一次自动单次许可；OpenRouter 尚未通过成功验真。</p><p class="detail__intro">两个真实 DeepSeek Flash 任务及首个任务的同会话续验，共 14 次主模型请求和 3 次官方 Decisions，全部 HTTP 200。实际构建、测试、后续主模型输入与文件结果均独立核对。审批仍有两条早期受控授权未批准的负例，不能把一次成功写成稳定效果。</p><p class="case__reading"><a href="../evidence/luna-decisions-results.html">公开验真报告 ↗</a> · <a href="${github}/blob/main/docs/testing/2026-10-07-luna-decisions/README.md" target="_blank" rel="noopener noreferrer">方法与验证范围 ↗</a> · <a href="${github}/blob/main/docs/testing/2026-10-07-luna-decisions/results.json" target="_blank" rel="noopener noreferrer">结构化结果 ↗</a></p></header>
  <section class="mechanism" id="setup" aria-labelledby="connection-title"><div class="section-heading"><p class="eyebrow">按 profile 保存</p><h2 id="connection-title">三套连接分别保留，所有已启用功能共用当前选择。</h2></div><p>在 Jev 设置页选择 Jev 或 Luna Decisions；Luna 再选择 OpenAI 或 OpenRouter。主 Agent 继续由 DSH 配置并负责规划、工具调用和回答。模型切换不启用功能，不改变原判断题、候选发现、概率门槛、超时或原生权限规则。</p><div class="connection-table-wrap"><table class="connection-table"><caption>完整请求地址、固定 Luna 模型与默认凭据引用</caption><thead><tr><th scope="col">连接</th><th scope="col">完整端点</th><th scope="col">请求模型</th><th scope="col">凭据引用</th></tr></thead><tbody>${rows}</tbody></table></div><ol><li>选择判断模型与 Luna API，核对该连接的地址、模型和凭据引用。</li><li>先保存连接设置，再使用密钥控件保存或替换对应引用的 API Key；成功后输入清空，页面不读回已保存密钥。</li><li>显式点击“测试连接”，发送不含任务内容的固定 Choice、Score、Noul 三类诊断。</li><li>查看判断记录中的实际渠道、返回模型、真实请求与原始响应、统一答案和动作回执，再按需开启业务功能。</li></ol><p class="case__reading">旧 profile 默认 Jev，保留原自定义地址、模型与凭据引用。两个 Luna 模型 ID 是同一指定能力在两种 API 中的命名，不能随意替换为其他 GPT 模型。合法自定义端点仍按显式所选 API 转换；读取、编辑、保存和切换设置不发起判断请求。</p></section>
  <section class="case" aria-labelledby="protocol-title"><div class="case__heading"><span class="case__kind">已验证接线与真实 API 的区别</span><h2 id="protocol-title">官方三题实际通过，OpenRouter 访问限制仍保留。</h2></div><p class="case__task">Jev 与 OpenRouter 使用 System One 的 state、问题映射和 noul；官方 Decisions 使用 input、问题数组和 predicate。插件直接转换回原 Choice、Score、Noul 含义，保留题目身份、原候选与等级顺序、小数以及实际存在的可选字段。</p><div class="case__finding"><span>实际观察</span><p>官方固定诊断真实返回 Choice=left、Score=0.49、Noul=0.98；Score 小数保留，predicate 转为 Noul，缺少的 Noul confidence 没有补造。原始数组与统一答案、持久成功记录已核对。OpenRouter 一次真实请求返回提供方服务条款访问限制的 HTTP 403，之后停止该渠道，没有成功验真。<span class="case__sources">证据：${evidenceLinks(['lunaDecisions'])}</span></p></div><p class="case__reading">确定性测试覆盖两渠道编码、解码、拒绝和 OpenRouter 完整分批；协议接线通过不等于该账号能调用真实 API。OpenRouter 超过 200 题时完整分批，全部成功才交付业务答案，共享原总超时；任何失败不自动转向 Jev、其他渠道或普通生成 API。</p></section>
  <div class="case-list" id="real-results">${cases.map((testCase, index) => `${index === 1 ? '<div id="approval-results"></div>' : ''}${caseSection(testCase, {}, index, 0)}`).join('')}<div class="detail-limits"><h2>边界与验证</h2><ul><li>两项真实任务为可丢弃合成项目，含一次同会话续验；不代表自然任务准确率、概率校准、平均收益或全部 12 项功能验收。</li><li>早期 6 次官方调用由固定主模型驱动，与后续真实主模型的 3 次 Luna 判断分别记录。真实任务的 5 路径全得 1，没有排序区分力改善；两条早期授权未批准的负例继续保留。</li><li>本轮没有新增真实 GUI cold stage 验证。历史 Jev 实验按当时模型与材料保留，不能作为 Luna 效果证据或跨模型优劣比较。</li><li>前轮官方报告 input 6,541 / output 0 tokens；真实任务的 3 次 Luna 报告 input 9,525 / output 0。实际金额未返回，output 为 0 不等于费用为 0。</li><li>判断成功、业务采纳、原生 allowed-once、工具执行和最终陈述分别核查。公开页面只使用整理后的报告，不包含密钥、账户信息、本机路径或原始会话捕获。</li></ul></div></div>
  <nav class="detail-next" aria-label="继续阅读"><a href="../index.html#features">← 返回业务功能概览</a><a href="../evidence/luna-decisions-results.html">公开验真记录 →</a></nav></article></div>`;
  return page({ title: 'Jev / Luna 判断连接与验真', description: '三套连接、官方有限真实任务、日志省略、单次许可、保留负例与 OpenRouter 访问限制。', depth: '../', body });
}

function evidencePage(source, content) {
  const original = `${github}/blob/main/${source.file}`;
  const body = `<div class="evidence-page shell"><nav class="breadcrumbs" aria-label="当前位置"><a href="../index.html">功能概览</a><span aria-hidden="true">/</span><span aria-current="page">公开证据</span></nav><header><p class="eyebrow">公开记录</p><h1>${escapeHtml(source.title)}</h1><p>以下为仓库 Markdown 原文字句，原文中的链接请到仓库页面使用。</p><a href="${original}" target="_blank" rel="noopener noreferrer">打开仓库原文 ↗</a></header><pre class="evidence-text">${escapeHtml(content)}</pre></div>`;
  return page({ title: source.title, description: `${source.title}的公开记录。`, depth: '../', body });
}

if (features.length !== 11 || new Set(features.map((feature) => feature.slug)).size !== features.length) {
  throw new Error('功能清单必须包含 11 个不重复的页面');
}
const sourceContents = await Promise.all(Object.values(evidence).map(async (source) => ({
  source,
  content: await readFile(join(repository, source.file), 'utf8'),
})));
await rm(output, { recursive: true, force: true });
await mkdir(join(output, 'assets'), { recursive: true });
await mkdir(join(output, 'features'), { recursive: true });
await mkdir(join(output, 'evidence'), { recursive: true });
await mkdir(join(output, 'connections'), { recursive: true });
await copyFile(join(website, 'src/styles.css'), join(output, 'assets/site.css'));
await writeFile(join(output, 'index.html'), homePage());
await writeFile(join(output, 'connections', 'luna-decisions.html'), connectionsPage());
for (const feature of features) {
  await writeFile(join(output, 'features', `${feature.slug}.html`), detailPage(feature));
}
for (const { source, content } of sourceContents) {
  await writeFile(join(output, 'evidence', `${source.slug}.html`), evidencePage(source, content));
}
console.log(`已构建 1 个首页、1 个判断连接页、${features.length} 个功能页、${Object.keys(evidence).length} 个公开证据页：${output}`);
