import { n as JevError } from "./types-Bf-UMMSE.js";
import s from "@deepseek-ai/schemastery";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
//#region packages/jev/lib/types/completion-report.js
const assessments = {
	complete: "The supplied report shows that the current-turn requirements are satisfied, with no obvious omission or contradiction. This is not independent verification of code or artifacts.",
	omission: "A current-turn requirement is unreported, unfinished, or has an unmet user-specified condition. Do not invent verification or delivery requirements.",
	contradiction: "Todo content or status and the final report disagree. This identifies a report inconsistency, not a verified code defect.",
	"needs-user": "Completion requires an unresolved user choice or authorization. An already-authorized report correction does not require a new decision.",
	unknown: "The supplied material is insufficient to judge reliably. This does not mean task success, task failure, or a technical request error."
};
/** Read only native records from the latest turn, including a cleared Todo list.
* @param agent - live ordinary root Agent.
* @param requestId - original direct-user identity captured at turn admission.
* @param supplements - already used or durably reserved supplemental rounds.
* @param maximum - current profile's supplemental round limit.
* @param budget - character limit saved with the actual input.
* @returns no input for a turn that has never written Todo, otherwise complete report material.
*/
function completionReport(agent, requestId, supplements, maximum, budget) {
	const events = agent.session.snapshotEvents();
	const start = events.findLastIndex((event) => event.type === "turn/start");
	const turn = events.slice(Math.max(0, start));
	const todo = turn.findLast((event) => event.type === "todo/write");
	if (todo?.type !== "todo/write") return void 0;
	const requirements = turn.flatMap((event) => event.type === "user/message" && event.data.source.kind === "user" ? [{
		id: event.data.id,
		content: event.data.content
	}] : []);
	const originalAvailable = start >= 0 && requirements.some((message) => message.id === requestId);
	const final = turn.findLast((event) => event.type === "assistant/message");
	const finalText = final?.type === "assistant/message" ? final.data.message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n") : "";
	const options = [
		...requirements.map((message, index) => ({
			id: `requirement-${index + 1}`,
			description: JSON.stringify(message.content)
		})),
		...todo.data.todos.map((item, index) => ({
			id: `todo-${index + 1}`,
			description: `[${item.status}] ${item.content}`
		})),
		{
			id: "final-answer",
			description: finalText || "最终正文为空 / Empty final answer"
		},
		{
			id: "overall",
			description: "整体材料 / The complete supplied material"
		},
		{
			id: "none",
			description: "未发现问题 / No issue identified (complete only)"
		}
	];
	return {
		state: {
			mode: "completion",
			reviewPoint: String(final?.seq ?? todo.seq),
			evidenceScope: "current turn requirements, latest Todo and latest final answer only",
			requirements: requirements.map((message) => ({
				id: message.id,
				content: JSON.parse(JSON.stringify(message.content))
			})),
			todos: todo.data.todos.map((item) => ({
				content: item.content,
				status: item.status
			})),
			finalAnswer: finalText,
			originalRequirementsAvailable: originalAvailable,
			supplementsUsed: supplements,
			maxSupplementRounds: maximum,
			evidenceCharacterBudget: budget,
			rules: "Review the supplied report only. The original requirements and subsequent adjustments are in chronological order; later explicit adjustments apply. Todo may contain historical work, but it does not replace the current-turn user requirements. Do not infer an earlier task from a new request saying continue. Empty Todo and empty final text are valid material. Select only the single most important issue; this is not an exhaustive review. Do not infer actual tool execution or artifact correctness from self-reported completion. Tests need to pass only if the user required that condition: running and truthfully reporting failed tests can satisfy a run-and-report request; a fix-and-pass request remains unmet while those tests fail. Todo pending status alone does not establish failure. Supplements stay within existing authorization, including read-only restrictions, and must not redo unrelated completed work, fabricate results, or force completed status. Unknown calls for truthful supporting information or an explanation of what remains unverified. Plugin notices are neither new user requirements nor new authorization."
		},
		questions: [{
			id: "assessment",
			kind: "choice",
			prompt: "Assess the current-turn report using the supplied rules.",
			options: Object.entries(assessments).map(([id, description]) => ({
				id,
				description
			}))
		}, {
			id: "focus",
			kind: "choice",
			prompt: "Choose the most important existing requirement, Todo entry, or final answer. Use overall for material-wide uncertainty; none is permitted only for complete.",
			options
		}]
	};
}
/** Refuse incomplete originals or oversized complete material without transport or truncation.
* @param request - exact saved input and its reference options.
* @param budget - live character limit for serialized material and both questions.
*/
function completionPreflight(request, budget) {
	if (typeof request.state !== "object" || request.state === null || Array.isArray(request.state) || !("originalRequirementsAvailable" in request.state) || request.state.originalRequirementsAvailable !== true) throw new JevError("COMPLETION_INPUT_MISSING", "本轮原始要求缺失，本次完成核查未完成 / Original current-turn requirements are unavailable; completion review did not finish");
	if (JSON.stringify(request).length > budget) throw new JevError("COMPLETION_BUDGET", "核查材料超出预算，本次完成核查未完成 / Review material exceeds the character budget; completion review did not finish");
}
/** Validate both bounded answers; valid unknown is a business conclusion.
* @param response - normalized provider answer.
* @param request - actual input defining all permitted references.
* @returns the assessment and its exact selected quotation, or no verdict for invalid answers.
*/
function completionVerdict(response, request) {
	const assessment = response.answers.find((answer) => answer.id === "assessment");
	const focus = response.answers.find((answer) => answer.id === "focus");
	if (response.answers.length !== 2 || assessment?.kind !== "choice" || focus?.kind !== "choice" || !Object.hasOwn(assessments, assessment.optionId)) return void 0;
	const question = request.questions.find((question) => question.id === "focus");
	const selected = question?.kind === "choice" ? question.options.find((option) => option.id === focus.optionId) : void 0;
	if (selected === void 0 || selected.id === "none" && assessment.optionId !== "complete") return void 0;
	return {
		value: assessment.optionId,
		reason: `${{
			complete: "报告核查完成 / Report review complete",
			omission: "发现遗漏或未满足条件 / Omission or unmet condition",
			contradiction: "报告前后矛盾，请核对并更正 / Check and correct inconsistent reporting",
			unknown: "材料不足，请补充真实依据或说明 / Add truthful supporting information or explain uncertainty",
			"needs-user": "需要用户决定 / A user decision is needed"
		}[assessment.optionId]}\n材料引用 / Material reference ${selected.id}: ${selected.description}`,
		issueKey: selected.id
	};
}
//#endregion
//#region packages/jev/lib/types/supervision.js
const Config = s.object({
	maxSupplementRounds: s.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(3).volatile(),
	driftInterval: s.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(6).volatile(),
	evidenceChars: s.number().step(1).min(1).max(1e6).default(24e3).volatile(),
	noProgressRounds: s.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(3).volatile()
});
const choices = {
	drift: [
		"on-track",
		"drift",
		"unknown"
	],
	completion: [
		"complete",
		"omission",
		"needs-user",
		"unknown"
	],
	progress: [
		"progress",
		"no-progress",
		"needs-user",
		"unknown"
	]
};
function verdict(response, request) {
	const assessment = response.answers.find((answer) => answer.id === "assessment");
	const evidence = response.answers.find((answer) => answer.id === "evidence");
	if (response.answers.length !== 2 || assessment?.kind !== "choice" || evidence?.kind !== "choice") return void 0;
	const question = request.questions.find((question) => question.id === "evidence");
	if (question?.kind !== "choice") return void 0;
	const selected = question.options.find((option) => option.id === evidence.optionId);
	if (selected === void 0 || selected.id === "insufficient-evidence") return void 0;
	const state = request.state;
	if (typeof state !== "object" || state === null || Array.isArray(state) || !("completeEvidence" in state) || state.completeEvidence !== true) return void 0;
	return {
		value: assessment.optionId,
		reason: `${{
			"on-track": "当前工作与要求一致 / Work follows the requirement",
			drift: "当前工作偏离所选要求；请回到该要求 / Return to the selected requirement",
			complete: "已有证据支持完成 / Recorded evidence supports completion",
			omission: "所选要求仍有缺项或最终事实与记录矛盾；请如实更正报告，其他补做限原授权，不擅自回滚、删除或修改文件 / Correct final factual claims contradicted by recorded evidence; address other omissions only within the original authorization, without unauthorized rollback, deletion, or file changes",
			"needs-user": "需要用户决定 / A user decision is needed",
			progress: "本轮增加有效调查或推进证据 / This round added useful evidence or progress",
			"no-progress": "本轮没有新增有效证据或推进 / This round added no useful evidence or progress",
			unknown: "证据不足 / Insufficient evidence"
		}[assessment.optionId] ?? assessment.optionId}\n记录引用 / Recorded reference ${selected.id}: ${String(selected.description)}`,
		issueKey: selected.id
	};
}
function lastUser(agent) {
	return agent.session.deriveMessages().findLast((message) => message.role === "user" && message.source.kind === "user")?.id ?? "";
}
function goalIdentity(goal) {
	return goal === void 0 ? "" : `${goal.id}:${goal.revision}:${goal.phase}`;
}
function version(ctx, agent) {
	return JSON.stringify([
		lastUser(agent),
		goalIdentity(ctx.goals.get(agent)),
		[...agent.inbox.nextStep, ...agent.inbox.nextTurn].filter((message) => message.source.kind === "user").map((message) => message.id)
	]);
}
/** Only recorded visible evidence is sent; reasoning blocks and new filesystem reads are excluded. */
function evidence(ctx, agent, mode, budget, requestId) {
	const history = agent.session.deriveMessages();
	const goal = ctx.goals.get(agent);
	let start = Math.max(0, history.findIndex((message) => message.id === requestId));
	if (goal?.phase === "active") {
		const rounds = history.flatMap((message, index) => message.role === "user" && message.source.kind === "goal" && message.source.goalId === goal.id && message.source.revision === goal.revision && message.source.round > 0 ? [index] : []);
		start = mode === "progress" ? rounds.at(-2) ?? rounds.at(-1) ?? start : rounds[0] ?? start;
	}
	const all = history.slice(start).map((message) => ({
		id: message.id,
		role: message.role,
		...message.role === "user" ? { source: message.source.kind } : {},
		content: message.content.filter((block) => block.type !== "reasoning")
	}));
	const messages = [];
	const goalSize = goal?.phase === "active" ? JSON.stringify(goal).length : 0;
	const omittedGoal = goalSize > budget;
	let remaining = Math.max(0, budget - goalSize);
	let omitted = 0;
	for (const message of all.toReversed()) {
		const size = JSON.stringify(message).length;
		if (size > remaining) {
			omitted++;
			continue;
		}
		messages.unshift(message);
		remaining -= size;
	}
	const candidates = messages.filter((message) => message.role === "user" && (message.source === "user" || message.source === "goal"));
	const options = (candidates.length === 0 ? messages : candidates).map((message) => ({
		id: message.id,
		description: JSON.stringify(message.content).slice(0, 800) + (JSON.stringify(message.content).length > 800 ? " [excerpt; full record above]" : "")
	}));
	if (goal?.phase === "active") options.unshift({
		id: goalIdentity(goal),
		description: omittedGoal ? "Goal objective exceeds evidence budget; choose unknown." : goal.objective
	});
	if (options.length === 0) options.push({
		id: "no-evidence",
		description: "No evidence fits the configured budget; choose unknown."
	});
	if (options.length < 2) options.push({
		id: "insufficient-evidence",
		description: "No supplied reference supports an assessment; choose unknown."
	});
	const state = JSON.parse(JSON.stringify({
		mode,
		goal: omittedGoal ? {
			id: goal?.id ?? "",
			objectiveOmitted: true
		} : goal ?? null,
		messages,
		completeEvidence: !omittedGoal && omitted === 0 && messages.length > 0,
		omittedMessages: omitted,
		excludedEarlierMessages: start,
		evidenceScope: goal?.phase === "active" ? mode === "progress" ? "current and previous goal round with current goal" : "current goal revision rounds" : "original user request and its subsequent work",
		evidenceCharacterBudget: budget,
		rules: "Use only recorded evidence. Assistant completion claims and successful tool dispatch are not verification. A test started without a result is not passed. A pass before later edits is stale for those edits. Explicitly required verification missing is an omission; insufficient information or omitted evidence is unknown. Necessary investigation and eliminating a relevant hypothesis are progress. Ignoring a reminder alone is not no-progress. In progress mode compare evidence added by the latest goal round to prior rounds. Select the requirement or recorded message supporting your assessment in the evidence question. Do not invent requirements or execute tools." + (mode === "completion" ? " Check the submitted answer and claimed deliverables, verification results, and side effects against the actual recorded tool results and applicable user requirements. A final factual claim contradicted by recorded evidence is an omission requiring correction, even if the requested investigation is otherwise finished; it cannot be complete. A supplement may correct the report or complete only work already allowed by the user. Read-only or no-repair instructions remain binding: do not require deleting artifacts, repairing files, or other unauthorized work. A reminder is not itself proof of a violation or a mandatory pause; needs-user requires an actual unresolved user decision, not merely a reminder or a correctable factual error." : "")
	}));
	const completionDescriptions = {
		complete: "The requested work and final factual claims are supported by recorded evidence, with no outstanding required work, verification, or factual correction.",
		omission: "Recorded evidence identifies unfinished required work, missing required verification, or a contradicted final factual claim that can be corrected within the existing user authorization.",
		"needs-user": "An unresolved decision or authorization from the user is necessary to finish; a report correction or other already-authorized work cannot resolve it.",
		unknown: "The recorded evidence is insufficient or omitted, so completion cannot be determined; do not infer success or invent missing work."
	};
	return {
		state,
		questions: [{
			id: "assessment",
			kind: "choice",
			prompt: "Assess " + mode + " from the existing evidence only." + (mode === "completion" ? " Check the submitted answer and claimed deliverables, verification results, and side effects against the actual recorded tool results and applicable user requirements. A final factual claim contradicted by recorded evidence is an omission requiring correction, even if the requested investigation is otherwise finished; it cannot be complete. A supplement may correct the report or complete only work already allowed by the user. Read-only or no-repair instructions remain binding: do not require deleting artifacts, repairing files, or other unauthorized work. A reminder is not itself proof of a violation or a mandatory pause; needs-user requires an actual unresolved user decision, not merely a reminder or a correctable factual error." : ""),
			options: mode === "completion" ? choices.completion.map((id) => ({
				id,
				description: completionDescriptions[id]
			})) : choices[mode].map((id) => ({
				id,
				description: id
			}))
		}, {
			id: "evidence",
			kind: "choice",
			prompt: "Which recorded requirement or message most directly supports the assessment?",
			options
		}]
	};
}
/** Install three independently enabled consumers; native goals retain exclusive continuation ownership. */
function apply(ctx, config) {
	const states = /* @__PURE__ */ new WeakMap();
	for (const feature of [
		{
			id: "drift-monitoring",
			name: "跑偏提醒 / Drift reminders",
			description: "后台检查已完成步骤；只提醒一次，不打断执行 / Background, non-blocking reminders"
		},
		{
			id: "completion-check",
			name: "完成核查 / Completion check",
			description: "回答展示后核查，按本轮报告核查，有限次补充 / Check current-turn reports with limited supplements"
		},
		{
			id: "goal-supervision",
			name: "目标增强 / Goal supervision",
			description: "核查模型完成申请；连续无进展暂停原生目标 / Guard completion and pause stalled native goals"
		}
	]) ctx.effect(() => ctx.jev.registerFeature(feature));
	ctx.effect(() => ctx.systemPrompt.section({
		name: "jev-completion-todo",
		order: 650,
		text: ({ agent }) => agent !== void 0 && ctx.agents.get(agent.id) === agent && ctx.agents.roots().includes(agent) && ctx.goals.get(agent)?.phase !== "active" && !states.get(agent)?.ownsGoalTurn && ctx.jev.isFeatureEnabled("completion-check") ? "When updating an existing Todo, briefly include actual actions, artifact paths, or executed commands and observed results in its content. Keep failures, unfinished work, and unverified results truthful. Do not create a Todo for a simple task solely for this check; no extra fields, evidence report, or separate preparation round is required." : ""
	}));
	ctx.effect(() => ctx.settings.configure({ auto: false }, ctx.fiber), "jev-supervision.settings");
	const tasks = /* @__PURE__ */ new Set();
	const assessments = /* @__PURE__ */ new Map();
	const lifetime = new AbortController();
	ctx.effect(() => async () => {
		lifetime.abort();
		await Promise.allSettled([...tasks]);
	});
	const live = (agent) => agent !== void 0 && ctx.agents.get(agent.id) === agent && ctx.agents.roots().includes(agent);
	const enabled = (feature) => ctx.jev.isFeatureEnabled(feature);
	const stateFor = (agent) => {
		let state = states.get(agent);
		if (state === void 0) {
			state = {
				steps: 0,
				enabled: false,
				active: false,
				turn: -1,
				requestId: "",
				completionRequestId: "",
				completionChecking: false,
				reminderScope: "",
				ownsGoalTurn: false,
				reminded: /* @__PURE__ */ new Set(),
				pending: [],
				stalled: 0,
				goalRevision: "",
				lastRound: -1
			};
			states.set(agent, state);
		}
		return state;
	};
	const receipt = (id, action, status, reason) => ctx.jev.writeReceipt(id, {
		id: action,
		status,
		at: (/* @__PURE__ */ new Date()).toISOString(),
		...reason === void 0 ? {} : { reason }
	});
	const notice = (state, operationId, action, text) => createUserMessage({
		source: {
			kind: "jev-supervision",
			form: "notice",
			summary: text,
			requestId: action === "supplement" || action.startsWith("completion-") || action === "supplement-unconfirmed" ? state.completionRequestId : state.requestId,
			action,
			operationId
		},
		content: [{
			type: "text",
			text
		}]
	});
	const pause = (agent) => {
		const goal = ctx.goals.get(agent);
		if (goal?.phase === "active") ctx.agents.withInitiator(agent, () => ctx.goals.pause(agent, {
			id: goal.id,
			revision: goal.revision
		}));
	};
	const current = (agent, state, identity) => live(agent) && state.active && !state.signal?.aborted && version(ctx, agent) === identity;
	async function judge(agent, state, mode, signal, feature) {
		let identity = "";
		let goalAtAttempt = "";
		let request;
		const outcome = await ctx.jev.judge({
			featureId: feature ?? (mode === "completion" && ctx.goals.get(agent)?.phase !== "active" ? "completion-check" : "goal-supervision"),
			agent,
			signal,
			link: {
				sessionId: agent.session.id,
				inputVersion: state.requestId
			},
			refresh: () => {
				identity = version(ctx, agent);
				goalAtAttempt = goalIdentity(ctx.goals.get(agent));
				request = evidence(ctx, agent, mode, config.evidenceChars.get(), state.requestId);
				return request;
			},
			interpret: (response) => {
				const result = verdict(response, request);
				return result !== void 0 && result.value !== "unknown" ? { usable: true } : {
					usable: false,
					reason: "Jev 无法判定 / Evidence is insufficient for this check"
				};
			},
			canAdopt: () => current(agent, state, identity) || "Requirements, goal, or execution changed"
		});
		if (outcome.kind === "ok") assessments.set(outcome.operationId, verdict(outcome.response, request));
		if (outcome.kind === "cancelled" && goalIdentity(ctx.goals.get(agent)) === goalAtAttempt) pause(agent);
		return outcome;
	}
	async function supplementUsage(agent, requestId) {
		const delivered = new Set(agent.session.snapshotEvents().flatMap((event) => event.type === "user/message" && event.data.source.kind === "jev-supervision" && event.data.source.requestId === requestId && event.data.source.action === "supplement" ? [event.data.source.operationId] : []));
		const used = new Set(delivered);
		const processedStops = /* @__PURE__ */ new Set();
		let unconfirmedOperationId;
		let cursor;
		do {
			const page = await ctx.jev.listRecords({
				featureId: "completion-check",
				sessionId: agent.session.id,
				limit: 100,
				...cursor === void 0 ? {} : { cursor }
			});
			for (const item of page.items) {
				const record = await ctx.jev.getRecord(item.id);
				if (record?.link.inputVersion !== requestId) continue;
				if (record.link.stepId !== void 0 && (record.status === "cancelled" || record.status === "succeeded") && !record.receipts.some((item) => item.status === "not-adopted")) processedStops.add(record.link.stepId);
				if (!record.receipts.some((item) => item.id === "supplement-reserved")) continue;
				if (record.receipts.some((item) => item.id === "supplement-stale")) continue;
				used.add(record.id);
				if (!delivered.has(record.id) && !record.receipts.some((item) => item.id === "supplement-queued")) unconfirmedOperationId = record.id;
			}
			cursor = page.nextCursor;
		} while (cursor !== void 0);
		return {
			used: used.size,
			processedStops,
			...unconfirmedOperationId === void 0 ? {} : { unconfirmedOperationId }
		};
	}
	const completionIdentity = (agent) => JSON.stringify([version(ctx, agent), [...agent.inbox.nextStep, ...agent.inbox.nextTurn].filter((message) => message.source.kind === "user")]);
	const completionCurrent = (agent, state, identity) => live(agent) && state.active && !state.signal?.aborted && completionIdentity(agent) === identity && agent.inbox.nextStep.length === 0 && !agent.inbox.nextTurn.some((message) => message.source.kind === "user");
	async function checkReport(agent, state, signal) {
		const initial = completionReport(agent, state.completionRequestId, 0, config.maxSupplementRounds.get(), config.evidenceChars.get());
		if (initial === void 0) return;
		const reviewPoint = typeof initial.state === "object" && initial.state !== null && "reviewPoint" in initial.state ? String(initial.state.reviewPoint) : "";
		const usage = await supplementUsage(agent, state.completionRequestId);
		if (usage.unconfirmedOperationId !== void 0) {
			if (agent.session.snapshotEvents().some((event) => event.type === "user/message" && event.data.source.kind === "jev-supervision" && event.data.source.operationId === usage.unconfirmedOperationId && event.data.source.action === "supplement-unconfirmed")) return;
			await receipt(usage.unconfirmedOperationId, "supplement-unconfirmed", "observed", "Previous supplement has an unknown action status; do not repeat it");
			agent.session.append("user/message", notice(state, usage.unconfirmedOperationId, "supplement-unconfirmed", "上次补充状态未确认，本次完成核查未完成 / Previous supplement remains unconfirmed; completion review did not finish"), { surfaceOp: "append" });
			return;
		}
		if (usage.processedStops.has(reviewPoint)) return;
		let identity = "";
		let request;
		const result = await ctx.jev.judge({
			featureId: "completion-check",
			agent,
			signal,
			link: {
				sessionId: agent.session.id,
				inputVersion: state.completionRequestId,
				stepId: reviewPoint
			},
			refresh: () => {
				identity = completionIdentity(agent);
				const input = completionReport(agent, state.completionRequestId, usage.used, config.maxSupplementRounds.get(), config.evidenceChars.get());
				if (input === void 0) throw new Error("Current turn changed during completion review");
				request = input;
				return request;
			},
			preflight: (input) => completionPreflight(input, config.evidenceChars.get()),
			failureDetail: (failure) => `本次完成核查未完成 / Completion review did not finish: ${failure.message}. 请调整配置后重试，或取消本次核查 / Retry with current input and settings, or cancel this review.`,
			interpret: (response) => completionVerdict(response, request) !== void 0 ? { usable: true } : {
				usable: false,
				reason: "完成核查响应或材料引用无效 / Invalid completion assessment or material reference"
			},
			canAdopt: () => completionCurrent(agent, state, identity) || "Current-turn requirements or execution changed"
		});
		if (result.kind !== "ok") return;
		const assessment = completionVerdict(result.response, request);
		if (!completionCurrent(agent, state, identity)) {
			await receipt(result.operationId, "completion-stale", "not-adopted", "Current turn changed before action");
			return;
		}
		const stop = async (reason) => {
			await receipt(result.operationId, "completion-stopped", "observed", JSON.stringify({
				assessment: assessment.value,
				supplementsUsed: usage.used,
				endingReason: reason
			}));
			agent.session.append("user/message", notice(state, result.operationId, "completion-stopped", "Jev 停止自动补充 / No further automatic work: " + assessment.reason + "\n" + reason), { surfaceOp: "append" });
		};
		if (assessment.value === "complete") {
			await receipt(result.operationId, "completion-checked", "observed", JSON.stringify({
				assessment: "complete",
				supplementsUsed: usage.used,
				endingReason: "Report satisfies current-turn requirements; not independent verification"
			}));
			agent.session.append("user/message", notice(state, result.operationId, "completion-checked", assessment.reason), { surfaceOp: "append" });
			return;
		}
		if (assessment.value === "needs-user") {
			await stop("需要用户选择或授权 / User choice or authorization required");
			return;
		}
		if (usage.used >= config.maxSupplementRounds.get()) {
			await stop("自动补充额度耗尽 / Supplemental round limit reached");
			return;
		}
		await receipt(result.operationId, "supplement-reserved", "observed", JSON.stringify({
			supplementsUsed: usage.used + 1,
			assessment: assessment.value,
			endingReason: "Supplement reserved before enqueue"
		}));
		if (!completionCurrent(agent, state, identity) || signal.aborted) {
			await receipt(result.operationId, "supplement-stale", "not-adopted", "Requirements changed after reservation");
			return;
		}
		agent.steer(notice(state, result.operationId, "supplement", "Jev 按本轮报告请求补充 / Supplement the current-turn report: " + assessment.reason + "\n仅处理最关键问题，在原授权内补做或更正报告；更新相关 Todo，保留失败、未完成和未验证事实，不重做无关完成项，不新增权限或编造结果 / Address this single issue within existing authorization, update the related Todo truthfully, preserve failures and unverified work, and do not redo unrelated completed work or invent results."));
		await receipt(result.operationId, "supplement-queued", "executed", JSON.stringify({
			supplementsUsed: usage.used + 1,
			assessment: assessment.value,
			endingReason: "Supplement queued in the same turn; report remains unchecked"
		})).catch((error) => {
			ctx.logger.warn("Jev supplement is already queued; its action receipt remains unconfirmed: " + String(error));
		});
	}
	ctx.effect(() => ctx.jev.onFeatureStateChange((features) => {
		for (const agent of ctx.agents.roots()) {
			const state = states.get(agent);
			if (state !== void 0 && state.enabled !== (features["drift-monitoring"] === true)) {
				state.enabled = features["drift-monitoring"] === true;
				state.steps = 0;
			}
		}
	}));
	ctx.on("agent/pre-step", async ({ agent, messages, turn, signal }, next) => {
		const decision = await next();
		if (decision.kind === "reject" || !live(agent)) return decision;
		const state = stateFor(agent);
		if (state.turn !== turn) {
			state.turn = turn;
			state.requestId = messages.find((message) => message.source.kind === "user")?.id ?? (lastUser(agent) || messages[0]?.id || "turn-" + turn);
			const events = agent.session.snapshotEvents();
			const original = events.slice(Math.max(0, events.findLastIndex((event) => event.type === "turn/start"))).find((event) => event.type === "user/message" && event.data.source.kind === "user");
			state.completionRequestId = original?.type === "user/message" ? original.data.id : state.requestId;
			const goal = ctx.goals.get(agent);
			state.ownsGoalTurn = goal?.phase === "active" || messages.some((message) => message.source.kind === "goal");
			const scope = goal?.phase === "active" ? goalIdentity(goal) : state.requestId;
			if (state.reminderScope !== scope) {
				state.reminderScope = scope;
				state.reminded.clear();
			}
		}
		state.active = true;
		state.signal = signal;
		const on = await enabled("drift-monitoring");
		if (on !== state.enabled) {
			state.enabled = on;
			state.steps = 0;
		}
		const identity = version(ctx, agent);
		const pending = state.pending.splice(0);
		const additions = [];
		for (const item of pending) {
			if (!current(agent, state, item.version) || messages.some((message) => message.source.kind === "user") || state.reminded.has(item.verdict.issueKey)) {
				receipt(item.outcome.operationId, "drift-not-delivered", "not-adopted", "Task changed, stopped, or this issue was already delivered").catch((error) => ctx.logger.warn(String(error)));
				continue;
			}
			state.reminded.add(item.verdict.issueKey);
			additions.push(notice(state, item.outcome.operationId, "drift", "Jev 跑偏提醒 / Correction: " + item.verdict.reason));
		}
		if (version(ctx, agent) !== identity) return decision;
		return {
			...decision,
			messages: [...decision.messages, ...additions]
		};
	}, { prepend: true });
	ctx.on("session/event", (session, event) => {
		const agent = ctx.agents.get(session.id);
		if (agent === void 0 || agent.session !== session || !live(agent)) return;
		const state = stateFor(agent);
		if (event.type === "turn/end") {
			state.active = false;
			for (const item of state.pending.splice(0)) {
				const task = receipt(item.outcome.operationId, "drift-not-delivered", "not-adopted", "Task ended before another model step").then(() => {}, (error) => ctx.logger.warn(String(error)));
				tasks.add(task);
				task.finally(() => tasks.delete(task));
			}
			return;
		}
		if (event.type === "user/message" && event.data.source.kind === "jev-supervision") {
			const source = event.data.source;
			const task = receipt(source.operationId, source.action + "-delivered", "executed", "Message admitted to the session").then(() => {}, (error) => {
				ctx.logger.warn("Jev action receipt remains unconfirmed: " + String(error));
			});
			tasks.add(task);
			task.finally(() => tasks.delete(task));
			return;
		}
		if (event.type !== "step/end" || !state.active) return;
		const task = (async () => {
			const on = await enabled("drift-monitoring");
			if (!state.active || state.signal?.aborted) return;
			if (!on) {
				state.enabled = false;
				state.steps = 0;
				return;
			}
			if (!state.enabled) {
				state.enabled = true;
				state.steps = 0;
			}
			if (++state.steps < config.driftInterval.get()) return;
			state.steps = 0;
			let identity = "";
			let request;
			const outcome = await ctx.jev.judgeOnce({
				featureId: "drift-monitoring",
				agent,
				signal: AbortSignal.any([lifetime.signal, ...state.signal === void 0 ? [] : [state.signal]]),
				link: {
					sessionId: session.id,
					stepId: String(event.seq),
					inputVersion: state.requestId
				},
				refresh: () => {
					identity = version(ctx, agent);
					request = evidence(ctx, agent, "drift", config.evidenceChars.get(), state.requestId);
					return request;
				},
				interpret: (response) => {
					const result = verdict(response, request);
					return result !== void 0 && result.value !== "unknown" ? { usable: true } : {
						usable: false,
						reason: "Drift is undetermined"
					};
				},
				canAdopt: () => current(agent, state, identity) || "Task changed or ended; no wakeup"
			});
			if (outcome.kind !== "ok") return;
			const result = verdict(outcome.response, request);
			if (result.value === "drift") {
				if (!current(agent, state, identity)) {
					await receipt(outcome.operationId, "drift-not-delivered", "not-adopted", "Task ended");
					return;
				}
				state.pending.push({
					outcome,
					verdict: result,
					version: identity
				});
			} else await receipt(outcome.operationId, "on-track", "observed");
		})().catch((error) => {
			ctx.logger.warn("Jev background supervision failed without blocking: " + String(error));
		});
		tasks.add(task);
		task.finally(() => tasks.delete(task));
	});
	ctx.on("agent/turn-stopping", async ({ agent, signal }) => {
		if (!live(agent) || signal.aborted || agent.inbox.nextStep.length > 0) return;
		const state = stateFor(agent);
		const goal = ctx.goals.get(agent);
		if (goal?.phase === "active") {
			if (!await enabled("goal-supervision")) return;
			const revision = goalIdentity(goal);
			if (state.goalRevision !== revision) {
				state.goalRevision = revision;
				state.stalled = 0;
				state.lastRound = -1;
			}
			if (goal.roundsStarted === 0 || state.lastRound === goal.roundsStarted) return;
			const result = await judge(agent, state, "progress", signal);
			if (result.kind !== "ok") return;
			const assessment = assessments.get(result.operationId);
			assessments.delete(result.operationId);
			state.lastRound = goal.roundsStarted;
			if (assessment.value === "progress") state.stalled = 0;
			else if (assessment.value === "no-progress") state.stalled++;
			if (assessment.value === "needs-user" || state.stalled >= config.noProgressRounds.get()) {
				pause(agent);
				agent.session.append("user/message", notice(state, result.operationId, "goal-paused", "Jev 已暂停目标 / Goal paused: " + assessment.reason), { surfaceOp: "append" });
				await receipt(result.operationId, "goal-paused", "executed", assessment.reason);
			} else await receipt(result.operationId, "progress-checked", "observed", assessment.reason);
			return;
		}
		if (state.ownsGoalTurn || !await enabled("completion-check") || !state.requestId || agent.inbox.nextTurn.some((message) => message.source.kind === "user")) return;
		if (!state.active || state.completionChecking) return;
		state.completionChecking = true;
		try {
			await checkReport(agent, state, signal);
		} finally {
			state.completionChecking = false;
		}
	});
	ctx.on("tools/pre-execute", async (exec, next) => {
		const decision = await next();
		if (decision.kind !== "allow" || exec.name !== "update_goal" || !live(exec.agent)) return decision;
		const args = exec.arguments;
		if (typeof args !== "object" || args === null || !("action" in args) || args.action !== "complete" || !await enabled("goal-supervision")) return decision;
		const agent = exec.agent;
		const goal = ctx.goals.get(agent);
		if (goal === void 0 || goal.phase === "complete") return decision;
		const identity = goalIdentity(goal);
		const result = await judge(agent, stateFor(agent), "completion", exec.signal, "goal-supervision");
		if (result.kind !== "ok") return {
			kind: "deny",
			reason: "Jev completion check was cancelled or became stale."
		};
		if (goalIdentity(ctx.goals.get(agent)) !== identity) {
			await receipt(result.operationId, "goal-complete-stale", "not-adopted", "Goal revision changed");
			return {
				kind: "deny",
				reason: "Goal changed during completion check."
			};
		}
		const assessment = assessments.get(result.operationId);
		assessments.delete(result.operationId);
		if (assessment.value === "complete") {
			await receipt(result.operationId, "goal-complete-allowed", "observed", "Evidence check passed; native goal tool still owns authorization and mutation");
			return decision;
		}
		if (assessment.value === "needs-user") pause(agent);
		await receipt(result.operationId, "goal-complete-denied", "observed", assessment.reason);
		return {
			kind: "deny",
			reason: "Jev: " + assessment.reason
		};
	}, { prepend: true });
}
const name = "jev-supervision";
const inject = [
	"jev",
	"agents",
	"tools",
	"goals",
	"sessions",
	"settings",
	"systemPrompt"
];
//#endregion
export { Config, apply, inject, name };
