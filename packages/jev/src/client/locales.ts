/** Copy for the Jev configuration and decision-record pages. */

/** Dictionary keys rendered by the Jev page. */
export type JevLocaleKey =
  | 'sharedFindingsName' | 'sharedFindingsDescription' | 'stageNavigationName' | 'stageNavigationDescription'
  | 'tabs' | 'settings' | 'records' | 'connection' | 'features' | 'noFeatures'
  | 'baseUrl' | 'model' | 'credentialRef' | 'timeoutMs' | 'apiKey' | 'apiKeyHint'
  | 'decisionModel' | 'jevModel' | 'lunaModel' | 'lunaApi' | 'openRouter' | 'openAI' | 'lunaModelHint' | 'connectionHint' | 'diagnosticHint'
  | 'connectionChanged' | 'providerRequests' | 'requestBody' | 'questionIds' | 'reportedModel' | 'requestId' | 'usageIncomplete'
  | 'configured' | 'missing' | 'readOnly' | 'unavailable' | 'loading'
  | 'saveConnection' | 'saveFirst' | 'saving' | 'saveFailed' | 'saveSuccess' | 'invalidTimeout'
  | 'selectionCounts' | 'skillSummaryCount' | 'fileRankingMaximum' | 'rankedPathCount'
  | 'selectionCountsHint' | 'selectionCountInvalid' | 'saveSelectionCounts' | 'selectionCountSaved' | 'selectionCountSaveFailed'
  | 'outputAdmissionSettings' | 'outputAdmissionHint' | 'outputAdmissionInvalid' | 'saveOutputAdmission' | 'outputAdmissionSaved' | 'outputAdmissionSaveFailed'
  | 'generalMinChars' | 'testMinChars' | 'generalBlockChars' | 'maxGeneralBlocks' | 'maxTestCandidates' | 'maxRequestChars' | 'maxTaskChars' | 'admissionWaitMs' | 'omitProbability' | 'minSavedChars' | 'minSavedRatio' | 'slowTestMs' | 'duplicateMinLines' | 'duplicateMinChars'
  | 'evidenceChars' | 'supervisionCounts' | 'driftInterval' | 'noProgressRounds' | 'supervisionCountsHint' | 'supervisionCountInvalid' | 'saveSupervisionCounts' | 'supervisionCountSaved' | 'supervisionCountSaveFailed'
  | 'stageSettings' | 'stageSettingsHint' | 'previousSteps' | 'previousChars' | 'stageMaxRequestChars' | 'stageConcurrency' | 'stageInvalid' | 'saveStageSettings' | 'stageSaved' | 'stageSaveFailed'
  | 'replaceKey' | 'saveKey' | 'keySaved' | 'keySaveFailed' | 'testConnection'
  | 'testing' | 'testSucceeded' | 'testFailed' | 'latency' | 'enable' | 'disable' | 'refreshFeatures'
  | 'featureSaveFailed' | 'featureLoadFailed' | 'retry' | 'allFeatures'
  | 'allStatuses' | 'sessionId' | 'applyFilters' | 'refresh' | 'noRecords'
  | 'recordsFailed' | 'loadMore' | 'details' | 'closeDetails' | 'detailFailed'
  | 'operation' | 'attempts' | 'receipts' | 'input' | 'questions'
  | 'answer' | 'rawAnswer' | 'connectionIdentity' | 'usage' | 'failure' | 'interpretation' | 'actualAction' | 'time'
  | 'status' | 'feature' | 'kind' | 'noDetail' | 'diagnostic'
  | 'pending' | 'waiting' | 'succeeded' | 'failed' | 'cancelled'
  | 'interrupted' | 'unconfirmed' | 'notAdopted' | 'executed' | 'executionFailed' | 'observed'

/** English copy. */
export const en: Record<JevLocaleKey, string> = {
  sharedFindingsName: 'Shared finding corrections', sharedFindingsDescription: 'Compare already shared reports and messages, correct actual recipients, and ask the root to verify conflicts.',
  stageNavigationName: 'Stage navigation', stageNavigationDescription: 'Manually classify complete recorded steps in a Session and browse adjacent purpose stages.',
  tabs: 'Jev pages', settings: 'Settings and features', records: 'Decision records',
  connection: 'Shared connection', features: 'Features', noFeatures: 'No features are registered yet.',
  baseUrl: 'Service address', model: 'Model', credentialRef: 'Credential reference', timeoutMs: 'Timeout (ms)',
  decisionModel: 'Judgment model', jevModel: 'Jev', lunaModel: 'Luna Decisions', lunaApi: 'Luna API', openRouter: 'OpenRouter', openAI: 'OpenAI',
  lunaModelHint: 'This API uses the fixed Luna Decisions model shown above.', connectionHint: 'All enabled features use the saved judgment connection. The main agent model is configured separately in DSH.',
  diagnosticHint: 'Test the saved connection with fixed Choice, Score, and Noul questions. No task content is sent.',
  connectionChanged: 'The connection changed. Refresh its saved settings before retrying.', providerRequests: 'Provider requests', requestBody: 'Sent request', questionIds: 'Question IDs', reportedModel: 'Reported model', requestId: 'Provider request ID', usageIncomplete: 'Usage is incomplete; some requests did not report usage.',
  apiKey: 'API key', apiKeyHint: 'Saved in Host credentials. This field never shows the saved key.',
  configured: 'Configured', missing: 'Missing', readOnly: 'Read-only', unavailable: 'Settings are unavailable.', loading: 'Loading…',
  saveConnection: 'Save connection', saveFirst: 'Save the connection before changing its key or testing it.', saving: 'Saving…', saveFailed: 'Could not save these settings.', saveSuccess: 'Connection settings saved.', invalidTimeout: 'Enter a whole number from 1 to 300,000 milliseconds.',
  selectionCounts: 'Selection counts', skillSummaryCount: 'Skill summaries shown', fileRankingMaximum: 'Maximum glob files for judgment ranking', rankedPathCount: 'Ranked paths shown',
  selectionCountsHint: 'If glob finds more files than the ranking maximum, judgment ranking is skipped and the original glob result is returned.',
  selectionCountInvalid: 'Enter a positive whole number.', saveSelectionCounts: 'Save selection counts', selectionCountSaved: 'Selection counts saved.', selectionCountSaveFailed: 'Could not save selection counts.',
  outputAdmissionSettings: 'Tool log admission limits', outputAdmissionHint: 'These limits apply to the next eligible tool result. The two feature switches above remain independent and off by default.',
  outputAdmissionInvalid: 'Enter a valid positive number, or a probability between 0 and 1.', saveOutputAdmission: 'Save log limits', outputAdmissionSaved: 'Log limits saved.', outputAdmissionSaveFailed: 'Could not save log limits.',
  generalMinChars: 'Minimum command log characters', testMinChars: 'Minimum test log characters', generalBlockChars: 'Candidate block characters', maxGeneralBlocks: 'Maximum command blocks',
  maxTestCandidates: 'Maximum test candidates', maxRequestChars: 'Judgment request characters', maxTaskChars: 'Task context characters', admissionWaitMs: 'Judgment wait (ms)',
  omitProbability: 'Minimum omit probability', minSavedChars: 'Minimum saved characters', minSavedRatio: 'Minimum saved fraction', slowTestMs: 'Slow test threshold (ms)',
  duplicateMinLines: 'Duplicate failure minimum lines', duplicateMinChars: 'Duplicate failure minimum characters',
  evidenceChars: 'Evidence character budget', supervisionCounts: 'Supervision counts', driftInterval: 'Completed model steps between drift checks', noProgressRounds: 'Consecutive goal rounds without progress', supervisionCountsHint: 'All three supervision features are independent and disabled by default. Native goal round limits still apply.', supervisionCountInvalid: 'Enter a positive whole number.', saveSupervisionCounts: 'Save supervision counts', supervisionCountSaved: 'Supervision counts saved.', supervisionCountSaveFailed: 'Could not save supervision counts.',
  stageSettings: 'Stage analysis limits', stageSettingsHint: 'Used only for manual analysis while stage navigation is enabled. The current step is never truncated; a request over the limit is skipped.', previousSteps: 'Prior steps in context', previousChars: 'Characters per prior step', stageMaxRequestChars: 'Maximum complete request characters', stageConcurrency: 'Concurrent judgment requests', stageInvalid: 'Enter a whole number within the allowed range.', saveStageSettings: 'Save stage limits', stageSaved: 'Stage limits saved.', stageSaveFailed: 'Could not save stage limits.',
  replaceKey: 'Replace key', saveKey: 'Save key', keySaved: 'Key saved.', keySaveFailed: 'Could not save the key. Refresh the saved connection before retrying.',
  testConnection: 'Test connection', testing: 'Testing…', testSucceeded: 'Connection test passed.', testFailed: 'Connection test failed.', latency: 'Latency',
  enable: 'Enable', disable: 'Disable', refreshFeatures: 'Refresh features', featureSaveFailed: 'Could not change this feature.', featureLoadFailed: 'Could not load features.', retry: 'Retry',
  allFeatures: 'All features', allStatuses: 'All statuses', sessionId: 'Session ID', applyFilters: 'Apply filters', refresh: 'Refresh', noRecords: 'No decision records match these filters.',
  recordsFailed: 'Could not refresh records. Existing records are still shown.', loadMore: 'Load more', details: 'Details', closeDetails: 'Close details', detailFailed: 'Could not load this record.',
  operation: 'Operation', attempts: 'Attempts', receipts: 'Action receipts', input: 'Input state', questions: 'Questions', answer: 'Normalized answer', rawAnswer: 'Raw response', connectionIdentity: 'Connection', usage: 'Reported usage', failure: 'Failure', interpretation: 'Interpretation', actualAction: 'Actual action', time: 'Time',
  status: 'Status', feature: 'Feature', kind: 'Kind', noDetail: 'No details for this record.', diagnostic: 'Connection diagnostic',
  pending: 'Pending', waiting: 'Waiting', succeeded: 'Succeeded', failed: 'Failed', cancelled: 'Cancelled',
  interrupted: 'Interrupted', unconfirmed: 'Unconfirmed', notAdopted: 'Not adopted', executed: 'Executed', executionFailed: 'Execution failed', observed: 'Observed',
}

/** Simplified Chinese copy. */
export const zh: Record<JevLocaleKey, string> = {
  sharedFindingsName: '共享发现纠正', sharedFindingsDescription: '比较已共享报告和消息，纠正实际接收者，并将冲突交给主代理核实。',
  stageNavigationName: '阶段导航', stageNavigationDescription: '手动分类会话中的完整步骤，并按轮次浏览连续目的阶段',
  tabs: 'Jev 页面', settings: '设置与功能', records: '判断记录',
  connection: '共用连接', features: '功能目录', noFeatures: '当前没有登记的功能',
  baseUrl: '服务地址', model: '模型', credentialRef: '凭据引用', timeoutMs: '超时（毫秒）',
  decisionModel: '判断模型', jevModel: 'Jev', lunaModel: 'Luna Decisions', lunaApi: 'Luna API', openRouter: 'OpenRouter', openAI: 'OpenAI',
  lunaModelHint: '此 API 使用上方显示的固定 Luna Decisions 模型', connectionHint: '已启用功能共用已保存的判断连接；主 Agent 模型在 DSH 中单独配置',
  diagnosticHint: '用固定 Choice、Score、Noul 问题测试已保存连接，不发送用户任务内容',
  connectionChanged: '连接已改变，请刷新已保存设置后重试', providerRequests: '提供方请求', requestBody: '实际发送请求', questionIds: '问题 ID', reportedModel: '返回模型', requestId: '提供方请求 ID', usageIncomplete: '用量不完整，部分请求未报告用量',
  apiKey: 'API 密钥', apiKeyHint: '写入宿主凭据；这里不会读回已保存的密钥',
  configured: '已配置', missing: '缺失', readOnly: '只读', unavailable: '设置暂不可用', loading: '加载中…',
  saveConnection: '保存连接', saveFirst: '请先保存连接，再替换密钥或测试连接', saving: '保存中…', saveFailed: '无法保存这些设置', saveSuccess: '连接设置已保存', invalidTimeout: '请输入 1 到 300,000 之间的整数毫秒数',
  selectionCounts: '筛选数量', skillSummaryCount: '展示的技能摘要数', fileRankingMaximum: '判断排序最大文件数', rankedPathCount: '展示的已排序路径数',
  selectionCountsHint: 'glob 匹配文件数超过排序上限时，跳过判断排序，直接返回原 glob 结果',
  selectionCountInvalid: '请输入正整数', saveSelectionCounts: '保存筛选数量', selectionCountSaved: '筛选数量已保存', selectionCountSaveFailed: '无法保存筛选数量',
  outputAdmissionSettings: '工具日志准入预算', outputAdmissionHint: '这些预算从下一次合格工具结果开始生效；上方两个功能开关互相独立，默认关闭。',
  outputAdmissionInvalid: '请输入有效正数；概率或比例须在 0 到 1 之间', saveOutputAdmission: '保存日志预算', outputAdmissionSaved: '日志预算已保存', outputAdmissionSaveFailed: '无法保存日志预算',
  generalMinChars: '命令日志最小字符数', testMinChars: '测试日志最小字符数', generalBlockChars: '候选块字符数', maxGeneralBlocks: '命令块数量上限',
  maxTestCandidates: '测试候选数量上限', maxRequestChars: '判断请求字符预算', maxTaskChars: '任务依据字符预算', admissionWaitMs: '判断等待毫秒数',
  omitProbability: '省略概率门槛', minSavedChars: '最小净省字符数', minSavedRatio: '最小净省比例', slowTestMs: '慢测试门槛（毫秒）',
  duplicateMinLines: '重复失败详情最少行数', duplicateMinChars: '重复失败详情最少字符数',
  evidenceChars: '已有证据字符预算', supervisionCounts: '执行监督次数', driftInterval: '跑偏检查间隔（已完成模型步骤）', noProgressRounds: '连续无进展目标轮数', supervisionCountsHint: '三项监督功能独立开关，默认关闭；目标总轮数仍遵守原生上限', supervisionCountInvalid: '请输入正整数', saveSupervisionCounts: '保存监督次数', supervisionCountSaved: '监督次数已保存', supervisionCountSaveFailed: '无法保存监督次数',
  stageSettings: '阶段分析预算', stageSettingsHint: '仅在启用阶段导航并手动分析时使用。当前完整步骤不会截断；请求超限时跳过分类', previousSteps: '纳入上下文的前序步骤数', previousChars: '每个前序步骤的字符数', stageMaxRequestChars: '完整请求字符上限', stageConcurrency: '同时发起的判断请求数', stageInvalid: '请输入允许范围内的整数', saveStageSettings: '保存阶段预算', stageSaved: '阶段预算已保存', stageSaveFailed: '无法保存阶段预算',
  replaceKey: '替换密钥', saveKey: '保存密钥', keySaved: '密钥已保存', keySaveFailed: '无法保存密钥，请刷新已保存连接后重试',
  testConnection: '测试连接', testing: '测试中…', testSucceeded: '连接测试通过', testFailed: '连接测试失败', latency: '耗时',
  enable: '启用', disable: '关闭', refreshFeatures: '刷新功能', featureSaveFailed: '无法修改此功能', featureLoadFailed: '无法加载功能目录', retry: '重试',
  allFeatures: '全部功能', allStatuses: '全部状态', sessionId: '会话 ID', applyFilters: '应用筛选', refresh: '刷新', noRecords: '没有符合条件的判断记录',
  recordsFailed: '无法刷新记录，已保留现有内容', loadMore: '加载更多', details: '详情', closeDetails: '关闭详情', detailFailed: '无法加载这条记录',
  operation: '操作', attempts: '尝试', receipts: '动作回执', input: '输入状态', questions: '问题', answer: '统一答案', rawAnswer: '原始响应', connectionIdentity: '连接身份', usage: '服务报告用量', failure: '失败原因', interpretation: '业务解释', actualAction: '实际动作', time: '时间',
  status: '状态', feature: '功能', kind: '类型', noDetail: '这条记录没有详情', diagnostic: '连接诊断',
  pending: '进行中', waiting: '等待处理', succeeded: '判断成功', failed: '失败', cancelled: '已取消',
  interrupted: '已中断', unconfirmed: '未确认', notAdopted: '未采用', executed: '已执行', executionFailed: '执行失败', observed: '已观察',
}
