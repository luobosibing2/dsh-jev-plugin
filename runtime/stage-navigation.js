import { n as JevError } from "./types-1VPjOrnR.js";
import s from "@deepseek-ai/schemastery";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { createHash, randomUUID } from "node:crypto";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { z } from "zod";
import { SessionId } from "@deepseek-ai/dsh-session";
//#region packages/jev/lib/types/stage-history.js
/** Assemble each `step/start` exactly once; attempts and parallel tools remain inside that step. */
function assembleStageHistory(sessionId, events) {
	const turns = /* @__PURE__ */ new Map();
	const steps = /* @__PURE__ */ new Map();
	let openTurn;
	const key = (turn, step) => `${turn}:${step}`;
	for (const event of events) switch (event.type) {
		case "turn/start":
			openTurn = {
				id: `${sessionId}:${event.seq}`,
				turn: event.data.turn,
				startSeq: event.seq,
				requests: [],
				steps: []
			};
			turns.set(event.data.turn, openTurn);
			break;
		case "turn/end": {
			const turn = turns.get(event.data.turn);
			if (turn !== void 0) {
				turn.endSeq = event.seq;
				turn.reason = event.data.reason;
				if (openTurn === turn) openTurn = void 0;
			}
			break;
		}
		case "user/message":
			if (openTurn !== void 0 && event.data.source.kind === "user") openTurn.requests.push({
				seq: event.seq,
				content: event.data.content
			});
			break;
		case "step/start": {
			const turn = turns.get(event.data.turn);
			if (turn === void 0) break;
			const step = {
				id: `${sessionId}:${event.seq}`,
				turn: event.data.turn,
				step: event.data.step,
				startSeq: event.seq,
				status: "in-progress",
				classifiable: false,
				materialStatus: "IN_PROGRESS",
				tools: [],
				attemptSeqs: [],
				messages: [],
				analysis: { status: "unanalysed" }
			};
			turn.steps.push(step);
			steps.set(key(event.data.turn, event.data.step), step);
			break;
		}
		case "step/end": {
			const step = steps.get(key(event.data.turn, event.data.step));
			if (step !== void 0) {
				step.endSeq = event.seq;
				step.status = "complete";
			}
			break;
		}
		case "assistant/message": {
			const step = steps.get(key(event.data.turn, event.data.step));
			if (step !== void 0) {
				const message = {
					seq: event.seq,
					content: event.data.message.content,
					interrupted: event.data.interrupted === true
				};
				step.messages.push(message);
				step.assistant = message;
			}
			break;
		}
		case "assistant/attempt":
			steps.get(key(event.data.turn, event.data.step))?.attemptSeqs.push(event.seq);
			break;
		case "tool/call":
			steps.get(key(event.data.turn, event.data.step))?.tools.push({
				seq: event.seq,
				callId: event.data.callId,
				name: event.data.name,
				arguments: event.data.arguments,
				dispatched: true
			});
			break;
		case "tool/result": {
			const call = steps.get(key(event.data.turn, event.data.step))?.tools.find((tool) => tool.callId === event.data.message.toolCallId);
			if (call !== void 0) call.result = {
				seq: event.seq,
				content: event.data.message.content,
				isError: event.data.message.isError === true,
				...event.data.error === void 0 ? {} : { error: event.data.error }
			};
			break;
		}
		default: break;
	}
	for (const turn of turns.values()) for (const step of turn.steps) {
		for (const message of step.messages) for (const block of message.content) {
			if (block.type !== "tool-call" || step.tools.some((tool) => tool.callId === block.id)) continue;
			step.tools.push({
				seq: message.seq,
				callId: block.id,
				name: block.name,
				arguments: block.arguments,
				dispatched: false
			});
		}
		step.tools.sort((a, b) => a.seq - b.seq);
		if (turn.endSeq !== void 0 && step.status === "in-progress") step.status = "terminal-partial";
	}
	return [...turns.values()].sort((a, b) => a.startSeq - b.startSeq);
}
//#endregion
//#region packages/jev/lib/types/stage-input.js
/** Complete step requests with bounded, explicitly marked preceding context. */
const STAGE_RULE_VERSION = "whole-step-v1";
const STAGE_REDACTION_VERSION = "credential-patterns-v2";
const labels = [
	["input_parsing", "Identify initial task input and constraints"],
	["problem_understanding", "Establish facts, investigate causes, or resolve open questions"],
	["solution_planning", "Select or revise an approach against known requirements"],
	["implementation", "Make or debug changes, including local reads, tests, and rework"],
	["review_validation", "Assess whether an existing result meets requirements"],
	["delivery_finalization", "Organize evidence, update delivery records, or hand off known work"],
	["mixed", "Several primary purposes cannot be reduced to one"],
	["unknown", "The recorded evidence does not support a purpose judgment"]
];
function redact(value, secrets) {
	let text = value;
	for (const secret of secrets) if (secret.length >= 4) text = text.replaceAll(secret, "[REDACTED]");
	return text.replace(/\b(Bearer|Basic)\s+[^\s"']+/gi, "$1 [REDACTED]").replace(/\b(?:sk|key|token|apikey)[-_][A-Za-z0-9_-]{12,}\b/gi, "[REDACTED]").replace(/((?:["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|passwd|authorization|auth[_-]?token)["']?)\s*[:=]\s*)(["'])(.*?)\2/gi, "$1$2[REDACTED]$2").replace(/((?:["']?(?:password|passwd|authorization)["']?)\s*[:=]\s*)(?!["'])[^\r\n,;}\]]+/gi, "$1[REDACTED]").replace(/((?:["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|passwd|authorization|auth[_-]?token)["']?)\s*[:=]\s*)(?!["'])[^\s,"';}]+/gi, "$1[REDACTED]").replace(/([?&#](?:api[_-]?key|access[_-]?token|refresh[_-]?token|key|token|secret|auth)\s*=)[^&#\s"']+/gi, "$1[REDACTED]").replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[REDACTED]@");
}
function visibleBlocks(blocks, secrets) {
	return blocks.map((block) => {
		switch (block.type) {
			case "text":
			case "reasoning": return {
				type: block.type,
				text: redact(block.text, secrets)
			};
			case "tool-call": return {
				type: block.type,
				name: redact(block.name, secrets),
				arguments: redact(block.arguments, secrets)
			};
			case "image": return {
				type: "image",
				present: true,
				understoodByJev: false,
				mediaType: block.attachment.mediaType,
				bytes: block.attachment.bytes,
				width: block.attachment.width,
				height: block.attachment.height,
				...block.attachment.name === void 0 ? {} : { name: redact(block.attachment.name, secrets) }
			};
			case "file": return {
				type: "file",
				present: true,
				understoodByJev: false,
				name: redact(block.attachment.name, secrets),
				bytes: block.attachment.bytes
			};
			default: return {
				type: block.type,
				present: true,
				understoodByJev: false
			};
		}
	});
}
function hasRecordedMaterial(step) {
	return step.tools.length > 0 || step.messages.some((message) => message.content.some((block) => {
		if (block.type === "text" || block.type === "reasoning") return block.text.trim().length > 0;
		return true;
	}));
}
function predecessor(step, chars, secrets) {
	const summary = redact(step.assistant?.content.filter((block) => block.type === "text").map((block) => block.text).join("\n") || step.assistant?.content.filter((block) => block.type === "reasoning").map((block) => block.text).join("\n") || "", secrets);
	return {
		stepId: step.id,
		text: summary.slice(0, chars),
		truncated: summary.length > chars,
		tools: step.tools.map((tool) => ({
			name: redact(tool.name, secrets),
			result: tool.result === void 0 ? "missing" : tool.result.isError ? "error" : "recorded"
		}))
	};
}
/** Preserve the entire recorded target; an over-limit request is never shortened. */
function buildStageInput(turns, target, limits, connectionIdentity, secrets = []) {
	const earlier = turns.flatMap((turn) => turn.steps).filter((step) => step.startSeq < target.startSeq);
	const previous = limits.previousSteps === 0 ? [] : earlier.slice(-limits.previousSteps).map((step) => predecessor(step, limits.previousChars, secrets));
	const targetTurn = turns.find((turn) => turn.turn === target.turn);
	const cutoff = target.assistant?.seq ?? target.endSeq ?? targetTurn?.endSeq ?? target.startSeq;
	const currentRequests = targetTurn?.requests.filter((message) => message.seq <= cutoff) ?? [];
	const requests = (currentRequests.length > 0 ? currentRequests : turns.filter((turn) => turn.startSeq < (targetTurn?.startSeq ?? target.startSeq)).findLast((turn) => turn.requests.length > 0)?.requests ?? []).map((message) => ({
		seq: message.seq,
		content: visibleBlocks(message.content, secrets)
	}));
	const assistant = target.messages.map((message) => ({
		seq: message.seq,
		interrupted: message.interrupted,
		content: visibleBlocks(message.content.filter((block) => block.type !== "tool-call"), secrets)
	}));
	const tools = target.tools.map((tool) => ({
		seq: tool.seq,
		callId: tool.callId,
		name: redact(tool.name, secrets),
		arguments: redact(tool.arguments, secrets),
		dispatched: tool.dispatched,
		result: tool.result === void 0 ? null : {
			seq: tool.result.seq,
			isError: tool.result.isError,
			content: visibleBlocks(tool.result.content, secrets),
			...tool.result.error === void 0 ? {} : { error: {
				name: redact(tool.result.error.name, secrets),
				code: redact(tool.result.error.code, secrets),
				...tool.result.error.reason === void 0 ? {} : { reason: redact(tool.result.error.reason, secrets) }
			} }
		}
	}));
	const request = {
		state: {
			ruleVersion: STAGE_RULE_VERSION,
			redactionVersion: STAGE_REDACTION_VERSION,
			sessionId: target.id.slice(0, target.id.lastIndexOf(":")),
			target: {
				stepId: target.id,
				turn: target.turn,
				step: target.step,
				status: target.status,
				assistant,
				tools,
				modelRetryAttemptSeqs: target.attemptSeqs
			},
			effectiveUserRequests: requests,
			previousSteps: previous,
			previousContext: {
				available: earlier.length,
				included: previous.length,
				maxCharsPerStep: limits.previousChars
			},
			nonTextMaterial: "Image and file content is represented only by presence markers; Jev cannot read that modality."
		},
		questions: [{
			id: "stage",
			kind: "choice",
			prompt: "Choose the main purpose of this complete recorded agent step. Read the entire step and the user requests that were in force then. Tool names, file names, and one isolated phrase do not define a stage. Do not infer later outcomes, successful execution, missing reasoning, or unseen image/file contents. Choose mixed if several primary purposes are inseparable; unknown if evidence is insufficient. Return only the typed choice.",
			options: labels.map(([id, description]) => ({
				id,
				description
			}))
		}]
	};
	const serialized = JSON.stringify(request);
	const fingerprint = createHash("sha256").update(JSON.stringify([
		STAGE_RULE_VERSION,
		STAGE_REDACTION_VERSION,
		connectionIdentity,
		serialized
	])).digest("hex");
	if (target.status === "in-progress") return {
		kind: "unavailable",
		code: "IN_PROGRESS",
		fingerprint
	};
	if (!hasRecordedMaterial(target)) return {
		kind: "unavailable",
		code: "NO_MATERIAL",
		fingerprint
	};
	if (serialized.length > limits.maxRequestChars) return {
		kind: "unavailable",
		code: "MATERIAL_TOO_LARGE",
		fingerprint
	};
	return {
		kind: "ready",
		request,
		fingerprint
	};
}
//#endregion
//#region packages/jev/lib/types/stage-store.js
/** Profile-owned stage judgments, separate from native Session history. */
const recordSchema = z.object({
	id: z.string().min(1),
	sessionId: z.string().min(1),
	stepId: z.string().min(1),
	revision: z.number().int().min(1),
	sourceFingerprint: z.string().min(1),
	ruleVersion: z.string().min(1),
	status: z.enum([
		"unanalysed",
		"pending",
		"succeeded",
		"failed",
		"cancelled",
		"interrupted",
		"stale",
		"unavailable"
	]),
	label: z.enum([
		"input_parsing",
		"problem_understanding",
		"solution_planning",
		"implementation",
		"review_validation",
		"delivery_finalization",
		"mixed",
		"unknown"
	]).optional(),
	confidence: z.number().min(0).max(1).optional(),
	probabilities: z.record(z.string(), z.number().min(0).max(1)).optional(),
	model: z.string().optional(),
	configuredModel: z.string().optional(),
	operationId: z.string().optional(),
	connectionId: z.enum([
		"jev",
		"luna-openrouter",
		"luna-openai"
	]).optional(),
	recordId: z.string().optional(),
	failure: z.object({
		code: z.string(),
		message: z.string()
	}).optional(),
	updatedAt: z.string().optional()
});
/** One profile never shares auxiliary classifications with another profile. */
function stageStoreSpec(profileDir) {
	return defineDomain({
		name: "jev_stage_" + createHash("sha256").update(profileDir).digest("hex").slice(0, 20),
		version: 1,
		layout: "per-record",
		tables: { records: domainTable(recordSchema) }
	});
}
var StageStore = class StageStore {
	domain;
	constructor(domain) {
		this.domain = domain;
	}
	static async open(facility, profileDir) {
		const store = new StageStore(await facility.open(stageStoreSpec(profileDir)));
		for (const record of store.all()) if (record.status === "pending") await store.save({
			...record,
			status: "interrupted",
			updatedAt: (/* @__PURE__ */ new Date()).toISOString()
		});
		return store;
	}
	all() {
		return [...this.domain.table("records").entries()].map(([, record]) => record);
	}
	forSession(sessionId) {
		return this.all().filter((record) => record.sessionId === sessionId);
	}
	async save(record) {
		await this.domain.table("records").put(record.id, record);
	}
	async close() {
		await this.domain.close();
	}
};
//#endregion
//#region packages/jev/lib/types/stage-navigation.js
/** Manual, persisted Jev classification over complete historical DSH steps. */
const name = "jev-stage-navigation";
const inject = [
	"jev",
	"sessionQuery",
	"sessionController",
	"storageDomain",
	"profileContext",
	"credentials",
	"settings"
];
const FEATURE = "stage-navigation";
const Config = s.object({
	previousSteps: s.number().step(1).min(0).max(20).default(2).volatile(),
	previousChars: s.number().step(1).min(0).max(1e5).default(700).volatile(),
	maxRequestChars: s.number().step(1).min(2048).max(1e7).default(48e3).volatile(),
	concurrency: s.number().step(1).min(1).max(8).default(1).volatile()
});
function latest(records) {
	return records.toSorted((a, b) => b.revision - a.revision)[0];
}
function summary(records, fingerprint, unavailable) {
	const selected = latest(records.filter((record) => record.sourceFingerprint === fingerprint)) ?? latest(records.filter((record) => record.status === "succeeded")) ?? latest(records);
	if (selected === void 0) return unavailable === void 0 ? { status: "unanalysed" } : {
		status: "unavailable",
		failure: {
			code: unavailable,
			message: unavailable.toLowerCase().replaceAll("_", " ")
		}
	};
	const stale = selected.sourceFingerprint !== fingerprint;
	const previous = selected.status === "succeeded" ? void 0 : latest(records.filter((record) => record.status === "succeeded" && record.id !== selected.id && record.label !== void 0));
	return {
		status: stale ? "stale" : selected.status,
		recordId: selected.id,
		...selected.label === void 0 ? {} : { label: selected.label },
		...selected.confidence === void 0 ? {} : { confidence: selected.confidence },
		...selected.probabilities === void 0 ? {} : { probabilities: selected.probabilities },
		...selected.model === void 0 ? {} : { model: selected.model },
		...selected.configuredModel === void 0 ? {} : { configuredModel: selected.configuredModel },
		...selected.connectionId === void 0 ? {} : { connectionId: selected.connectionId },
		...selected.operationId === void 0 ? {} : { operationId: selected.operationId },
		...selected.failure === void 0 ? {} : { failure: selected.failure },
		...selected.updatedAt === void 0 ? {} : { updatedAt: selected.updatedAt },
		...previous === void 0 ? {} : { previousResult: {
			recordId: previous.id,
			label: previous.label,
			stale: previous.sourceFingerprint !== fingerprint,
			...previous.confidence === void 0 ? {} : { confidence: previous.confidence },
			...previous.probabilities === void 0 ? {} : { probabilities: previous.probabilities },
			...previous.model === void 0 ? {} : { model: previous.model },
			...previous.configuredModel === void 0 ? {} : { configuredModel: previous.configuredModel },
			...previous.connectionId === void 0 ? {} : { connectionId: previous.connectionId },
			...previous.updatedAt === void 0 ? {} : { updatedAt: previous.updatedAt }
		} }
	};
}
/** Optional Host manager bound to the common Jev Remote namespace. */
var StageNavigationManager = class {
	ctx;
	config;
	store;
	batches = /* @__PURE__ */ new Map();
	bySession = /* @__PURE__ */ new Map();
	starting = /* @__PURE__ */ new Map();
	preparations = /* @__PURE__ */ new Map();
	stopping = false;
	constructor(ctx, config, store) {
		this.ctx = ctx;
		this.config = config;
		this.store = store;
	}
	settings() {
		return {
			previousSteps: this.config.previousSteps.get(),
			previousChars: this.config.previousChars.get(),
			maxRequestChars: this.config.maxRequestChars.get(),
			concurrency: this.config.concurrency.get()
		};
	}
	async preparation(signal) {
		for (;;) {
			signal.throwIfAborted();
			const connections = this.ctx.jev.stageConnections();
			const connection = this.ctx.jev.judgmentConnectionIdentity();
			const identity = this.identity();
			const refs = [...new Set(connections.map((item) => item.credentialRef))];
			const secrets = [];
			for (const ref of refs) {
				let value;
				try {
					value = (await this.ctx.credentials.resolve(credentialRef(ref)))?.value;
				} catch {
					throw new JevError("CREDENTIAL_UNAVAILABLE", "Judgment credentials could not be checked for stage input redaction");
				}
				signal.throwIfAborted();
				if (value === void 0) continue;
				if (value.length < 4) throw new JevError("CREDENTIAL_UNSAFE", "A judgment credential is too short for safe stage input redaction");
				secrets.push(value);
			}
			if (JSON.stringify(connections) === JSON.stringify(this.ctx.jev.stageConnections()) && identity === this.identity()) return {
				secrets,
				identity,
				connection
			};
		}
	}
	identity() {
		return JSON.stringify(this.ctx.jev.stageConnectionIdentity());
	}
	/** Probe the native history API's durable address checks before reading the same immutable cut. */
	async source(sessionId, signal) {
		const observation = await this.ctx.sessionQuery.observeSession(SessionId(sessionId), {
			signal,
			projectionMode: "none"
		});
		try {
			const header = observation.header;
			const address = header.origin === "subagent" ? header.parentSession === void 0 ? null : {
				kind: "subagent",
				parentSessionId: header.parentSession,
				childSessionId: header.id,
				mode: "unknown"
			} : {
				kind: "session",
				sessionId: header.id
			};
			if (address === null) throw new JevError("SESSION_ADDRESS_UNAVAILABLE", "The selected subagent has no durable parent address");
			await this.ctx.sessionController.page({
				address,
				throughSeq: observation.cursor,
				maxMessages: 1
			}, signal);
			signal.throwIfAborted();
			return {
				cursor: observation.cursor,
				turns: assembleStageHistory(sessionId, observation.events)
			};
		} finally {
			observation[Symbol.dispose]();
		}
	}
	/** Read history and status without starting Jev or the native Agent. */
	async read(sessionId, signal) {
		const source = await this.source(sessionId, signal);
		const records = this.store.forSession(sessionId);
		const { secrets, identity } = await this.preparation(signal);
		const settings = this.settings();
		const turns = source.turns.map((turn) => ({
			...turn,
			steps: turn.steps.map((step) => {
				const input = buildStageInput(source.turns, step, settings, identity, secrets);
				const analysis = summary(records.filter((record) => record.stepId === step.id), input.fingerprint, input.kind === "unavailable" ? input.code : void 0);
				const batch = this.bySession.get(sessionId);
				const claimed = batch?.tasks.findIndex((item) => item.step.id === step.id) ?? -1;
				if ((analysis.status === "pending" || analysis.status === "unanalysed" && claimed >= 0 && claimed < (batch?.next ?? 0)) && batch !== void 0 && batch.state.status !== "running") return {
					...step,
					classifiable: input.kind === "ready",
					materialStatus: input.kind === "ready" ? "ready" : input.code,
					analysis: {
						...analysis,
						status: batch.state.status === "cancelled" ? "cancelled" : "failed",
						failure: batch.state.failure ?? {
							code: "INTERRUPTED",
							message: "Stage analysis did not finish"
						}
					}
				};
				return {
					...step,
					classifiable: input.kind === "ready",
					materialStatus: input.kind === "ready" ? "ready" : input.code,
					analysis
				};
			})
		}));
		return {
			sessionId,
			cursor: source.cursor,
			turns,
			featureEnabled: this.ctx.jev.isFeatureEnabled(FEATURE),
			...this.bySession.get(sessionId) === void 0 ? {} : { batch: { ...this.bySession.get(sessionId).state } }
		};
	}
	/** Return the selected record only after the same native history check. */
	async detail(sessionId, stepId, requestedRecordId) {
		const step = (await this.read(sessionId, new AbortController().signal)).turns.flatMap((turn) => turn.steps).find((item) => item.id === stepId);
		const recordId = requestedRecordId ?? step?.analysis.recordId;
		if (recordId === void 0) return null;
		if (step === void 0) return null;
		const record = this.store.forSession(sessionId).find((item) => item.id === recordId && item.stepId === stepId);
		if (record === void 0) return null;
		const attempt = (record.operationId === void 0 ? null : await this.ctx.jev.getRecord(record.operationId))?.attemptRecords.at(-1);
		return {
			...record,
			status: recordId === step.analysis.recordId ? step.analysis.status : record.status,
			...attempt?.request === void 0 ? {} : { request: attempt.request },
			...attempt?.response === void 0 ? {} : { response: attempt.response },
			...attempt?.rawResponse === void 0 ? {} : { rawResponse: attempt.rawResponse },
			...attempt?.connection === void 0 ? {} : { connection: attempt.connection },
			...attempt?.networkRecords === void 0 ? {} : { networkRecords: attempt.networkRecords },
			...attempt?.usage === void 0 ? {} : { usage: attempt.usage },
			...attempt?.usageComplete === void 0 ? {} : { usageComplete: attempt.usageComplete }
		};
	}
	/** Freeze one explicit user-selected scope; duplicate clicks share its active batch. */
	start(request) {
		if (this.stopping) throw new JevError("UNAVAILABLE", "Stage navigation is stopping");
		if (!this.ctx.jev.isFeatureEnabled("stage-navigation")) throw new JevError("FEATURE_DISABLED", "Stage navigation is disabled");
		const active = this.bySession.get(request.sessionId);
		if (active !== void 0 && !active.done) return Promise.resolve({ ...active.state });
		const starting = this.starting.get(request.sessionId);
		if (starting !== void 0) return starting;
		if (![
			"missing",
			"retry-failed",
			"refresh"
		].includes(request.mode)) throw new JevError("INVALID_SCOPE", "Invalid stage analysis mode");
		const controller = new AbortController();
		this.preparations.set(request.sessionId, controller);
		const work = this.prepare(request, controller).finally(() => {
			if (this.preparations.get(request.sessionId) === controller) this.preparations.delete(request.sessionId);
			if (this.starting.get(request.sessionId) === work) this.starting.delete(request.sessionId);
		});
		this.starting.set(request.sessionId, work);
		return work;
	}
	async prepare(request, controller) {
		const snapshot = await this.read(request.sessionId, controller.signal);
		const selectedTurn = request.scope.kind === "turn" ? request.scope.turn : void 0;
		const selected = selectedTurn !== void 0 ? snapshot.turns.filter((turn) => turn.turn === selectedTurn) : request.scope.kind === "all" ? snapshot.turns.filter((turn) => turn.endSeq !== void 0) : [];
		if (selected.length === 0 || selected.some((turn) => turn.endSeq === void 0)) throw new JevError("INVALID_SCOPE", "Select one ended turn or all ended turns");
		const { secrets, identity } = await this.preparation(controller.signal);
		if (controller.signal.aborted || this.stopping || !this.ctx.jev.isFeatureEnabled("stage-navigation")) throw new JevError("CANCELLED", "Stage analysis was cancelled before dispatch");
		const settings = this.settings();
		const tasks = [];
		for (const turn of selected) for (const step of turn.steps) {
			const status = step.analysis.status;
			if (request.mode === "missing" && status !== "unanalysed") continue;
			if (request.mode === "retry-failed" && ![
				"failed",
				"cancelled",
				"interrupted"
			].includes(status)) continue;
			const input = buildStageInput(snapshot.turns, step, settings, identity, secrets);
			if (input.kind === "ready") tasks.push({
				step,
				input
			});
		}
		const state = {
			id: randomUUID(),
			sessionId: request.sessionId,
			status: tasks.length === 0 ? "completed" : "running",
			total: tasks.length,
			completed: 0,
			failed: 0,
			cancelled: 0
		};
		const batch = {
			state,
			controller,
			tasks,
			sourceTurns: snapshot.turns.slice(),
			next: 0,
			halt: false,
			done: tasks.length === 0
		};
		this.batches.set(state.id, batch);
		this.bySession.set(request.sessionId, batch);
		if (tasks.length > 0) batch.work = this.run(batch, settings.concurrency).catch(() => {
			batch.state.status = "failed";
			batch.state.failure = {
				code: "RECORD_FAILURE",
				message: "Stage batch could not finish recording results"
			};
		}).finally(() => {
			batch.done = true;
		});
		return { ...state };
	}
	async currentFingerprint(sessionId, stepId, signal) {
		const source = await this.source(sessionId, signal);
		const step = source.turns.flatMap((turn) => turn.steps).find((item) => item.id === stepId);
		if (step === void 0) return void 0;
		const { secrets, identity } = await this.preparation(signal);
		return buildStageInput(source.turns, step, this.settings(), identity, secrets).fingerprint;
	}
	async classify(batch, task) {
		const { step } = task;
		const prepared = await this.preparation(batch.controller.signal);
		const fresh = buildStageInput(batch.sourceTurns, step, this.settings(), prepared.identity, prepared.secrets);
		if (fresh.kind === "unavailable") return "failed";
		task.input = fresh;
		const input = fresh;
		const at = (/* @__PURE__ */ new Date()).toISOString();
		const record = {
			id: randomUUID(),
			sessionId: batch.state.sessionId,
			stepId: step.id,
			revision: this.store.forSession(batch.state.sessionId).filter((item) => item.stepId === step.id).length + 1,
			sourceFingerprint: input.fingerprint,
			ruleVersion: STAGE_RULE_VERSION,
			status: "pending",
			updatedAt: at
		};
		await this.store.save(record);
		if (batch.controller.signal.aborted || !this.ctx.jev.isFeatureEnabled("stage-navigation")) {
			await this.store.save({
				...record,
				status: "cancelled",
				updatedAt: (/* @__PURE__ */ new Date()).toISOString()
			});
			return "cancelled";
		}
		const outcome = await this.ctx.jev.judgeOnce({
			featureId: FEATURE,
			signal: batch.controller.signal,
			connection: prepared.connection,
			link: {
				sessionId: batch.state.sessionId,
				stepId: step.id,
				inputVersion: input.fingerprint
			},
			refresh: () => input.request,
			canAdopt: async () => {
				if (batch.controller.signal.aborted || !this.ctx.jev.isFeatureEnabled("stage-navigation")) return "Stage analysis was cancelled";
				return await this.currentFingerprint(batch.state.sessionId, step.id, batch.controller.signal) === input.fingerprint ? true : "Recorded step material or classification settings changed";
			}
		});
		const updatedAt = (/* @__PURE__ */ new Date()).toISOString();
		if (outcome.kind === "ok") {
			const answer = outcome.response.answers.find((item) => item.id === "stage");
			if (answer?.kind !== "choice") throw new JevError("INVALID_RESPONSE", "Jev did not return a stage choice");
			const attempt = (await this.ctx.jev.getRecord(outcome.operationId))?.attemptRecords.find((item) => item.id === outcome.attemptId);
			const raw = attempt?.rawResponse;
			const rawModel = raw !== void 0 && raw !== null && typeof raw === "object" ? Object.entries(raw).find(([key]) => key === "model")?.[1] : void 0;
			const returnedModel = attempt?.networkRecords?.at(-1)?.returnedModel ?? (typeof rawModel === "string" ? rawModel : void 0);
			const successful = {
				...record,
				status: "succeeded",
				label: answer.optionId,
				...answer.confidence === void 0 ? {} : { confidence: answer.confidence },
				...answer.probabilities === void 0 ? {} : { probabilities: answer.probabilities },
				...returnedModel === void 0 ? {} : { model: returnedModel },
				configuredModel: attempt?.connection.model ?? prepared.connection.model,
				...attempt?.connection.connectionId === void 0 ? {} : { connectionId: attempt.connection.connectionId },
				operationId: outcome.operationId,
				updatedAt
			};
			let current;
			if (!batch.controller.signal.aborted && this.ctx.jev.isFeatureEnabled("stage-navigation")) try {
				current = await this.currentFingerprint(batch.state.sessionId, step.id, batch.controller.signal);
			} catch (error) {
				if (!batch.controller.signal.aborted) throw error;
			}
			if (batch.controller.signal.aborted || !this.ctx.jev.isFeatureEnabled("stage-navigation") || current !== input.fingerprint) {
				await this.store.save({
					...record,
					status: "cancelled",
					operationId: outcome.operationId,
					updatedAt
				});
				return "cancelled";
			}
			await this.store.save(successful);
			if (batch.controller.signal.aborted || !this.ctx.jev.isFeatureEnabled("stage-navigation")) {
				await this.store.save({
					...record,
					status: "cancelled",
					operationId: outcome.operationId,
					updatedAt: (/* @__PURE__ */ new Date()).toISOString()
				});
				return "cancelled";
			}
			return "ok";
		}
		if (outcome.kind === "cancelled" || batch.controller.signal.aborted) {
			await this.store.save({
				...record,
				status: "cancelled",
				..."operationId" in outcome ? { operationId: outcome.operationId } : {},
				updatedAt
			});
			return "cancelled";
		}
		const failure = outcome.kind === "failed" ? outcome.failure : {
			code: "NOT_ADOPTED",
			message: outcome.reason
		};
		await this.store.save({
			...record,
			status: "failed",
			failure,
			...outcome.operationId === void 0 ? {} : { operationId: outcome.operationId },
			updatedAt
		});
		return [
			"AUTH",
			"PAYMENT_REQUIRED",
			"CREDENTIAL_MISSING",
			"RATE_LIMIT"
		].includes(failure.code) ? "halt" : "failed";
	}
	async run(batch, concurrency) {
		const worker = async () => {
			while (!batch.controller.signal.aborted && !batch.halt && batch.next < batch.tasks.length) {
				const task = batch.tasks[batch.next++];
				try {
					const outcome = await this.classify(batch, task);
					if (outcome === "ok") batch.state.completed++;
					else if (outcome === "cancelled") batch.state.cancelled++;
					else {
						batch.state.failed++;
						if (outcome === "halt") {
							batch.halt = true;
							batch.state.failure = {
								code: "CONNECTION_BLOCKED",
								message: "Jev credentials or account require attention"
							};
						}
					}
				} catch {
					batch.halt = true;
					batch.state.failed++;
					batch.state.failure = {
						code: "RECORD_FAILURE",
						message: "Stage result could not be saved or read"
					};
				}
			}
		};
		await Promise.all(Array.from({ length: Math.min(concurrency, batch.tasks.length) }, () => worker()));
		if (batch.controller.signal.aborted) for (const task of batch.tasks.slice(batch.next)) {
			try {
				await this.store.save({
					id: randomUUID(),
					sessionId: batch.state.sessionId,
					stepId: task.step.id,
					revision: this.store.forSession(batch.state.sessionId).filter((item) => item.stepId === task.step.id).length + 1,
					sourceFingerprint: task.input.fingerprint,
					ruleVersion: STAGE_RULE_VERSION,
					status: "cancelled",
					updatedAt: (/* @__PURE__ */ new Date()).toISOString()
				});
			} catch {
				batch.state.failure = {
					code: "RECORD_FAILURE",
					message: "Some cancelled targets could not be saved"
				};
			}
			batch.state.cancelled++;
		}
		batch.state.status = batch.controller.signal.aborted ? "cancelled" : batch.halt ? "failed" : "completed";
	}
	async cancel(batchId) {
		const batch = this.batches.get(batchId);
		if (batch?.state.status === "running") batch.controller.abort();
		await batch?.work;
	}
	/** Disablement and unload stop only this consumer's auxiliary work. */
	async stop() {
		this.stopping = true;
		for (const controller of this.preparations.values()) controller.abort();
		for (const batch of this.batches.values()) if (batch.state.status === "running") batch.controller.abort();
		await Promise.allSettled([...this.starting.values()]);
		await Promise.allSettled([...this.batches.values()].map((batch) => batch.work));
		await this.store.close();
	}
	cancelRunning() {
		for (const controller of this.preparations.values()) controller.abort();
		for (const batch of this.batches.values()) if (batch.state.status === "running") batch.controller.abort();
	}
};
/** Register a disabled-by-default Jev feature and its optional Host history provider. */
async function apply(ctx, config) {
	const manager = new StageNavigationManager(ctx, config, await StageStore.open(ctx.storageDomain, ctx.profileContext.dir));
	ctx.effect(() => ctx.jev.registerFeature({
		id: FEATURE,
		name: "Stage navigation",
		description: "Manually classify complete recorded Session steps for historical navigation"
	}), "jev-stage-navigation.feature");
	ctx.effect(() => ctx.jev.registerStageNavigation(manager), "jev-stage-navigation.remote");
	ctx.effect(() => ctx.jev.onFeatureStateChange((features) => {
		if (features["stage-navigation"] !== true) manager.cancelRunning();
	}), "jev-stage-navigation.enabled");
	ctx.effect(() => ctx.settings.configure({ auto: false }, ctx.fiber), "jev-stage-navigation.settings");
	ctx.effect(() => () => manager.stop(), "jev-stage-navigation.storage");
}
//#endregion
export { Config, FEATURE, StageNavigationManager, apply, inject, name };
