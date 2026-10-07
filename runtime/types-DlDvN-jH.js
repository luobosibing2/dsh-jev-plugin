import { Service } from "@deepseek-ai/cordis";
import s from "@deepseek-ai/schemastery";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { createHash, randomUUID } from "node:crypto";
import { LlmAdapter, LlmError, attributionHeaders } from "@deepseek-ai/dsh-llm";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { z } from "zod";
//#region packages/jev/lib/types/wire.js
function record(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function json(value) {
	if (value === null || typeof value === "string" || typeof value === "boolean") return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (Array.isArray(value)) return value.every(json);
	return record(value) && Object.values(value).every(json);
}
function input(value) {
	return typeof value === "string" || json(value) && value !== null && typeof value === "object";
}
function probability$1(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}
/** Reject invalid questions before a ledger write or model call. */
function validateRequest(request) {
	if (!json(request.state)) throw new TypeError("Jev state must be JSON");
	if (!Array.isArray(request.questions) || request.questions.length === 0) throw new TypeError("Jev needs at least one question");
	const ids = /* @__PURE__ */ new Set();
	for (const question of request.questions) {
		if (typeof question.id !== "string" || question.id.length === 0 || ids.has(question.id)) throw new TypeError("Jev question ids must be nonempty and unique");
		ids.add(question.id);
		if (!input(question.prompt)) throw new TypeError(`Jev question ${question.id} needs JSON instructions`);
		switch (question.kind) {
			case "choice": {
				if (!Array.isArray(question.options) || question.options.length === 0) throw new TypeError(`Jev choice ${question.id} needs options`);
				const choices = /* @__PURE__ */ new Set();
				for (const option of question.options) {
					if (typeof option.id !== "string" || option.id.length === 0 || choices.has(option.id) || option.description !== null && !input(option.description)) throw new TypeError(`Jev choice ${question.id} has an invalid option`);
					choices.add(option.id);
				}
				break;
			}
			case "score":
				if (!Array.isArray(question.levels) || question.levels.length < 2 || question.levels.length > 10 || question.levels.some((level) => level !== null && !input(level))) throw new TypeError(`Jev score ${question.id} needs 2 to 10 ordered levels`);
				break;
			case "noul":
				if (question.criteria !== void 0 && Object.values(question.criteria).some((value) => value !== null && value !== void 0 && !input(value))) throw new TypeError(`Jev noul ${question.id} has invalid criteria`);
				break;
			default: throw new TypeError(`Jev question ${question.id} has unsupported kind`);
		}
	}
}
/** Encode the typed public request into the provider's System One HTTP body. */
function wireBody(model, request) {
	validateRequest(request);
	const questions = Object.fromEntries(request.questions.map((question) => [question.id, wireQuestion(question)]));
	return {
		model,
		state: request.state,
		questions
	};
}
function wireQuestion(question) {
	switch (question.kind) {
		case "choice": return {
			type: "choice",
			instructions: question.prompt,
			criteria: Object.fromEntries(question.options.map((option) => [option.id, option.description]))
		};
		case "score": return {
			type: "score",
			instructions: question.prompt,
			criteria: question.levels
		};
		case "noul": return {
			type: "noul",
			instructions: question.prompt,
			...question.criteria === void 0 ? {} : { criteria: question.criteria }
		};
	}
}
/** Parse every answer, including optional probabilities and service signals, or reject the whole request. */
function parseWireResponse(raw, request) {
	if (!json(raw) || !record(raw) || !record(raw.answers)) throw new TypeError("Jev response has no answers object");
	const answers = raw.answers;
	if (Object.keys(answers).length !== request.questions.length) throw new TypeError("Jev response has missing or extra answers");
	const parsed = [];
	for (const question of request.questions) {
		const value = answers[question.id];
		if (!record(value)) throw new TypeError(`Jev answer ${question.id} is missing`);
		if (value.type === "refusal" || value.refusal !== void 0) throw new DecisionResponseError("REFUSAL", "Decision provider refused a question");
		if (value.type !== void 0 && value.type !== question.kind) throw new TypeError(`Jev answer ${question.id} has the wrong type`);
		const confidence = value.confidence;
		if (confidence !== void 0 && !probability$1(confidence)) throw new TypeError(`Jev answer ${question.id} has invalid confidence`);
		const signals = {
			...confidence === void 0 ? {} : { confidence },
			...value.legend === void 0 ? {} : { legend: value.legend }
		};
		if (question.kind === "choice") {
			if (typeof value.choice !== "string" || !question.options.some((option) => option.id === value.choice)) throw new TypeError(`Jev choice ${question.id} picked an unknown option`);
			const probabilities = parseProbabilities(value.probabilities, question.options.map((option) => option.id), question.id);
			parsed.push({
				id: question.id,
				kind: "choice",
				optionId: value.choice,
				...probabilities === void 0 ? {} : { probabilities },
				...signals
			});
		} else if (question.kind === "score") {
			if (typeof value.score !== "number" || !Number.isFinite(value.score) || value.score < 0 || value.score > question.levels.length - 1) throw new TypeError(`Jev score ${question.id} is outside its rubric`);
			const probabilities = parseProbabilities(value.probabilities, question.levels.map((_, index) => String(index)), question.id);
			parsed.push({
				id: question.id,
				kind: "score",
				value: value.score,
				...probabilities === void 0 ? {} : { probabilities },
				...signals
			});
		} else {
			if (!probability$1(value.noul)) throw new TypeError(`Jev noul ${question.id} has invalid probability`);
			parsed.push({
				id: question.id,
				kind: "noul",
				probability: value.noul,
				...signals
			});
		}
	}
	const usage = parseUsage(raw);
	return {
		response: { answers: parsed },
		...usage === void 0 ? {} : { usage },
		raw
	};
}
/** A provider rejection is a failed attempt, never a business answer. */
var DecisionResponseError = class extends TypeError {
	code;
	constructor(code, message) {
		super(message);
		this.code = code;
	}
};
function text(value) {
	return typeof value === "string" ? value : JSON.stringify(value);
}
/** Encode complete business input for the explicitly selected Decisions protocol. */
function protocolBody(connectionId, model, request) {
	if (connectionId === "jev") return wireBody(model, request);
	if (connectionId === "luna-openrouter") {
		validateRequest(request);
		return {
			model,
			state: typeof request.state === "string" || request.state !== null && typeof request.state === "object" ? request.state : JSON.stringify(request.state),
			questions: Object.fromEntries(request.questions.map((question) => {
				if (question.kind === "score") return [question.id, {
					type: "score",
					instructions: question.prompt,
					criteria: question.levels.map((level) => level ?? "")
				}];
				if (question.kind === "noul" && question.criteria !== void 0 && (question.criteria.true === null || question.criteria.true === void 0 || question.criteria.false === null || question.criteria.false === void 0)) return [question.id, {
					type: "noul",
					instructions: {
						instructions: question.prompt,
						criteria: question.criteria
					}
				}];
				return [question.id, wireQuestion(question)];
			}))
		};
	}
	validateRequest(request);
	return {
		model,
		input: text(request.state),
		questions: request.questions.map((question) => {
			const common = {
				name: question.id,
				instructions: text(question.prompt)
			};
			switch (question.kind) {
				case "choice": return {
					...common,
					type: "choice",
					choices: question.options.map((option) => ({
						value: option.id,
						...option.description === null || option.description === "" ? {} : { description: text(option.description) }
					}))
				};
				case "score": return {
					...common,
					type: "score",
					levels: question.levels.map((level, index) => ({
						label: String(index),
						...level === null || level === "" ? {} : { description: text(level) }
					}))
				};
				case "noul": return {
					...common,
					type: "predicate",
					instructions: question.criteria === void 0 ? common.instructions : JSON.stringify({
						instructions: question.prompt,
						criteria: question.criteria
					})
				};
			}
		})
	};
}
/** Read known counts independently of answer validation so refusals retain usage. */
function knownUsage(raw) {
	if (!record(raw) || !record(raw.usage)) return void 0;
	const inputTokens = raw.usage.input_tokens;
	const outputTokens = raw.usage.output_tokens;
	const count = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
	if (!count(inputTokens) && !count(outputTokens)) return void 0;
	return {
		...count(inputTokens) ? { inputTokens } : {},
		...count(outputTokens) ? { outputTokens } : {}
	};
}
function parseUsage(raw) {
	if (raw.usage === void 0 || raw.usage === null) return void 0;
	if (!record(raw.usage)) throw new TypeError("Decision usage is invalid");
	for (const key of ["input_tokens", "output_tokens"]) {
		const value = raw.usage[key];
		if (value !== void 0 && (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)) throw new TypeError("Decision usage count is invalid");
	}
	return knownUsage(raw) ?? {};
}
function nativeProbabilities(value, question) {
	if (!Array.isArray(value)) throw new TypeError("Decision probabilities are missing");
	const allowed = question.kind === "choice" ? question.options.map((option) => option.id) : question.levels.map((_, index) => String(index));
	const result = {};
	for (const item of value) {
		if (!record(item) || !probability$1(item.probability) || (question.kind === "choice" ? typeof item.value !== "string" : typeof item.value !== "number" || !Number.isInteger(item.value) || typeof item.label !== "string")) throw new TypeError("Decision probability item is invalid");
		const key = String(item.value);
		if (!allowed.includes(key) || Object.hasOwn(result, key)) throw new TypeError("Decision probability identity is invalid");
		Object.defineProperty(result, key, {
			value: item.probability,
			enumerable: true,
			configurable: true,
			writable: true
		});
	}
	if (Object.keys(result).length !== allowed.length) throw new TypeError("Decision probabilities are incomplete");
	return Object.fromEntries(allowed.map((key) => [key, result[key]]));
}
/** Decode the provider's original response directly into the existing business answers. */
function parseProtocolResponse(raw, request, connectionId = "jev") {
	if (connectionId !== "luna-openai") return parseWireResponse(raw, request);
	if (!json(raw) || !record(raw) || !Array.isArray(raw.answers)) throw new TypeError("Decision response has no answers array");
	if (raw.answers.length !== request.questions.length) throw new TypeError("Decision response has missing or extra answers");
	const byName = /* @__PURE__ */ new Map();
	for (const value of raw.answers) {
		if (!record(value)) throw new TypeError("Decision answer identity is invalid");
		if (value.type === "refusal") throw new DecisionResponseError("REFUSAL", "Decision provider refused a question");
		if (typeof value.name !== "string" || byName.has(value.name)) throw new TypeError("Decision answer identity is invalid");
		byName.set(value.name, value);
	}
	const answers = request.questions.map((question) => {
		const value = byName.get(question.id);
		if (value === void 0 || value.type !== (question.kind === "noul" ? "predicate" : question.kind)) throw new TypeError("Decision answer type or identity is invalid");
		if (value.confidence !== void 0 && !probability$1(value.confidence)) throw new TypeError("Decision confidence is invalid");
		const signals = {
			...value.confidence === void 0 ? {} : { confidence: value.confidence },
			...value.legend === void 0 ? {} : { legend: value.legend }
		};
		if (question.kind === "noul") {
			if (!probability$1(value.probability)) throw new TypeError("Decision predicate probability is invalid");
			return {
				id: question.id,
				kind: "noul",
				probability: value.probability,
				...signals
			};
		}
		if (!probability$1(value.confidence)) throw new TypeError("Decision confidence is missing");
		const probabilities = nativeProbabilities(value.probabilities, question);
		if (question.kind === "choice") {
			if (typeof value.choice !== "string" || !question.options.some((option) => option.id === value.choice)) throw new TypeError("Decision choice is unknown");
			return {
				id: question.id,
				kind: "choice",
				optionId: value.choice,
				probabilities,
				...signals
			};
		}
		if (typeof value.score !== "number" || !Number.isFinite(value.score) || value.score < 0 || value.score > question.levels.length - 1) throw new TypeError("Decision score is outside its rubric");
		return {
			id: question.id,
			kind: "score",
			value: value.score,
			probabilities,
			...signals
		};
	});
	const usage = parseUsage(raw);
	return {
		response: { answers },
		raw,
		...usage === void 0 ? {} : { usage }
	};
}
/** Reconstruct one complete attempt from its actual network responses in original question order. */
function replayNetworkResponses(request, records, connectionId) {
	const answers = /* @__PURE__ */ new Map();
	for (const exchange of records) {
		if (exchange.status !== "succeeded" || exchange.rawResponse === void 0) throw new TypeError("Decision network request did not succeed");
		const questions = exchange.questionIds.map((id) => {
			const question = request.questions.find((item) => item.id === id);
			if (question === void 0 || answers.has(id)) throw new TypeError("Decision network question identity is invalid");
			return question;
		});
		if (new Set(exchange.questionIds).size !== exchange.questionIds.length) throw new TypeError("Decision network question identity is duplicated");
		const part = {
			state: request.state,
			questions
		};
		if (JSON.stringify(protocolBody(connectionId, exchange.requestBody.model ?? "", part)) !== JSON.stringify(exchange.requestBody)) throw new TypeError("Decision network input differs from business input");
		if (exchange.rawResponseText !== void 0 && JSON.stringify(JSON.parse(exchange.rawResponseText)) !== JSON.stringify(exchange.rawResponse)) throw new TypeError("Decision raw response differs from original text");
		for (const answer of parseProtocolResponse(exchange.rawResponse, part, connectionId).response.answers) answers.set(answer.id, answer);
	}
	if (answers.size !== request.questions.length) throw new TypeError("Decision network answers are incomplete");
	return { answers: request.questions.map((question) => answers.get(question.id)) };
}
/** Sum only observed counts; completeness requires every expected request and both counts. */
function aggregateUsage(records, complete) {
	let inputTokens;
	let outputTokens;
	for (const record of records) {
		if (record.usage?.inputTokens !== void 0) inputTokens = (inputTokens ?? 0) + record.usage.inputTokens;
		if (record.usage?.outputTokens !== void 0) outputTokens = (outputTokens ?? 0) + record.usage.outputTokens;
	}
	return {
		...inputTokens === void 0 && outputTokens === void 0 ? {} : { usage: {
			...inputTokens === void 0 ? {} : { inputTokens },
			...outputTokens === void 0 ? {} : { outputTokens }
		} },
		usageComplete: complete && records.length > 0 && records.every((record) => record.usage?.inputTokens !== void 0 && record.usage.outputTokens !== void 0)
	};
}
function parseProbabilities(value, allowed, id) {
	if (value === void 0) return void 0;
	if (!record(value)) throw new TypeError(`Jev answer ${id} probabilities are invalid`);
	const allowedSet = new Set(allowed);
	if (Object.keys(value).length !== allowed.length) throw new TypeError(`Jev answer ${id} probabilities are incomplete`);
	for (const [key, chance] of Object.entries(value)) if (!allowedSet.has(key) || !probability$1(chance)) throw new TypeError(`Jev answer ${id} probabilities are invalid`);
	return value;
}
//#endregion
//#region packages/jev/lib/types/adapter.js
/** Dedicated System One adapter used only by JevService's typed one-shot calls. */
const JEV_PROVIDER = "jev-system-one";
/** The adapter never advertises a chat model and rejects calls lacking a service-issued nonce. */
var JevAdapter = class extends LlmAdapter {
	pending = /* @__PURE__ */ new Map();
	issue(request, connection, canStart, record) {
		const nonce = randomUUID();
		const records = [];
		this.pending.set(nonce, {
			request,
			connection,
			canStart,
			record,
			records
		});
		return {
			envelope: JSON.stringify({
				version: 1,
				nonce,
				state: request.state,
				questions: request.questions
			}),
			records,
			release: () => {
				this.pending.delete(nonce);
			}
		};
	}
	async *stream(options) {
		const { nonce, request } = this.envelope(options);
		const call = this.pending.get(nonce);
		if (call === void 0 || options.model !== call.connection.model || JSON.stringify(request) !== JSON.stringify(call.request)) throw new LlmError("Jev accepts only issued typed judgments", "UNSUPPORTED_OPTION");
		const { connection } = call;
		const limit = connection.connectionId === "luna-openrouter" ? 200 : request.questions.length;
		for (let offset = 0; offset < request.questions.length; offset += limit) {
			if (options.signal?.aborted) throw new LlmError("Decision request was cancelled or timed out", "ABORTED");
			if (call.canStart?.() === false) throw new LlmError("Decision feature was disabled before dispatch", "FEATURE_DISABLED");
			const part = {
				state: request.state,
				questions: request.questions.slice(offset, offset + limit)
			};
			const exchange = {
				id: randomUUID(),
				questionIds: part.questions.map((question) => question.id),
				requestBody: protocolBody(connection.connectionId, connection.model, part),
				startedAt: (/* @__PURE__ */ new Date()).toISOString(),
				status: "pending"
			};
			call.records.push(exchange);
			await this.save(call);
			try {
				if (options.signal?.aborted) throw new LlmError("Decision request was cancelled or timed out", "ABORTED");
				if (call.canStart?.() === false) throw new LlmError("Decision feature was disabled before dispatch", "FEATURE_DISABLED");
				exchange.dispatchedAt = (/* @__PURE__ */ new Date()).toISOString();
				await this.exchange(exchange, part, connection, options.signal);
				exchange.status = "succeeded";
			} catch (error) {
				exchange.status = "failed";
				exchange.failure = {
					code: error instanceof LlmError ? error.code : "INVALID_RESPONSE",
					message: "Decision network request failed"
				};
				throw error;
			} finally {
				exchange.settledAt = (/* @__PURE__ */ new Date()).toISOString();
				await this.save(call);
			}
		}
		const text = JSON.stringify(call.records.map((record) => record.rawResponse));
		yield {
			type: "block-start",
			index: 0,
			blockType: "text"
		};
		yield {
			type: "text-delta",
			index: 0,
			text
		};
		yield {
			type: "block-end",
			index: 0,
			block: {
				type: "text",
				text
			}
		};
		yield {
			type: "finish",
			reason: { kind: "stop" }
		};
	}
	async save(call) {
		try {
			await call.record?.(call.records);
		} catch (error) {
			throw new LlmError("Decision network record could not be saved", "LOG_WRITE_FAILED", { cause: error });
		}
	}
	async exchange(exchange, part, connection, signal) {
		const response = await fetch(connection.baseUrl, {
			method: "POST",
			headers: {
				...attributionHeaders(),
				authorization: `Bearer ${connection.apiKey}`,
				"content-type": "application/json",
				accept: "application/json"
			},
			body: JSON.stringify(exchange.requestBody),
			signal,
			redirect: "error"
		}).catch((error) => {
			if (signal?.aborted) throw new LlmError("Jev request was cancelled or timed out", "ABORTED");
			throw new LlmError("Jev service could not be reached", "NETWORK", { cause: error });
		});
		exchange.httpStatus = response.status;
		const requestId = response.headers.get("x-request-id");
		if (requestId !== null) exchange.requestId = requestId;
		const raw = await response.text().catch((error) => {
			throw new LlmError("Decision response could not be read", signal?.aborted ? "ABORTED" : "NETWORK", { cause: error });
		});
		if (raw.length > 2e6) throw new LlmError("Jev response exceeds 2 MB", "INVALID_RESPONSE");
		exchange.rawResponseText = raw;
		try {
			const parsed = JSON.parse(raw);
			if (parsed !== void 0) {
				exchange.rawResponse = parsed;
				exchange.usage = knownUsage(parsed);
				if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
					if ("model" in parsed && typeof parsed.model === "string") exchange.returnedModel = parsed.model;
					if (exchange.requestId === void 0 && "id" in parsed && typeof parsed.id === "string") exchange.requestId = parsed.id;
				}
			}
		} catch {}
		if (!response.ok) {
			const code = response.status === 401 || response.status === 403 ? "AUTH" : response.status === 402 ? "PAYMENT_REQUIRED" : response.status === 429 ? "RATE_LIMIT" : response.status >= 500 ? "SERVER" : "BAD_REQUEST";
			throw new LlmError(`Jev service returned HTTP ${response.status}`, code, { status: response.status });
		}
		try {
			parseProtocolResponse(exchange.rawResponse, part, connection.connectionId);
		} catch (error) {
			throw new LlmError("Decision answer failed complete type validation", error instanceof DecisionResponseError ? error.code : "INVALID_RESPONSE");
		}
	}
	envelope(options) {
		if (options.provider !== "jev-system-one" || options.system !== void 0 || options.tools !== void 0 || options.temperature !== void 0 || options.stop !== void 0 || options.maxTokens !== void 0 || options.reasoningEffort !== void 0 || options.messages.length !== 1) throw new LlmError("Jev is not a chat model", "UNSUPPORTED_OPTION");
		const message = options.messages[0];
		const content = message?.role === "user" ? message.content : void 0;
		if (!Array.isArray(content) || content.length !== 1 || content[0]?.type !== "text") throw new LlmError("Jev accepts only issued typed judgments", "UNSUPPORTED_OPTION");
		let raw;
		try {
			raw = JSON.parse(content[0].text);
		} catch {
			throw new LlmError("Jev typed request envelope is invalid", "UNSUPPORTED_OPTION");
		}
		if (typeof raw !== "object" || raw === null || Array.isArray(raw) || !("version" in raw) || raw.version !== 1 || !("nonce" in raw) || typeof raw.nonce !== "string" || !("state" in raw) || !("questions" in raw)) throw new LlmError("Jev typed request envelope is invalid", "UNSUPPORTED_OPTION");
		const request = {
			state: raw.state,
			questions: raw.questions
		};
		try {
			validateRequest(request);
		} catch {
			throw new LlmError("Jev typed request envelope is invalid", "UNSUPPORTED_OPTION");
		}
		return {
			nonce: raw.nonce,
			request
		};
	}
};
//#endregion
//#region packages/jev/lib/types/ledger.js
/** Profile-scoped durable operation, attempt, and action records. */
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isJson(value) {
	if (value === null || typeof value === "string" || typeof value === "boolean") return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (Array.isArray(value)) return value.every(isJson);
	return isRecord(value) && Object.values(value).every(isJson);
}
function isInput(value) {
	return typeof value === "string" || isJson(value) && value !== null && typeof value === "object";
}
const nonempty = z.string().min(1);
const jsonSchema = z.custom(isJson);
const inputSchema = z.custom(isInput);
const questionSchema = z.discriminatedUnion("kind", [
	z.object({
		id: nonempty,
		kind: z.literal("choice"),
		prompt: inputSchema,
		options: z.array(z.object({
			id: nonempty,
			description: inputSchema.nullable()
		})).min(1)
	}),
	z.object({
		id: nonempty,
		kind: z.literal("score"),
		prompt: inputSchema,
		levels: z.array(inputSchema.nullable()).min(2).max(10)
	}),
	z.object({
		id: nonempty,
		kind: z.literal("noul"),
		prompt: inputSchema,
		criteria: z.object({
			true: inputSchema.nullable().optional(),
			false: inputSchema.nullable().optional()
		}).optional()
	})
]);
const requestSchema = z.object({
	state: jsonSchema,
	questions: z.array(questionSchema).min(1)
}).refine((request) => {
	try {
		validateRequest(request);
		return true;
	} catch {
		return false;
	}
});
const probability = z.number().min(0).max(1);
const answerSchema = z.discriminatedUnion("kind", [
	z.object({
		id: nonempty,
		kind: z.literal("choice"),
		optionId: nonempty,
		probabilities: z.record(z.string(), probability).optional(),
		confidence: probability.optional(),
		legend: jsonSchema.optional()
	}),
	z.object({
		id: nonempty,
		kind: z.literal("score"),
		value: z.number().finite(),
		probabilities: z.record(z.string(), probability).optional(),
		confidence: probability.optional(),
		legend: jsonSchema.optional()
	}),
	z.object({
		id: nonempty,
		kind: z.literal("noul"),
		probability,
		confidence: probability.optional(),
		legend: jsonSchema.optional()
	})
]);
const statusSchema = z.enum([
	"pending",
	"waiting",
	"succeeded",
	"failed",
	"cancelled",
	"interrupted"
]);
const actionStatusSchema = z.enum([
	"unconfirmed",
	"not-adopted",
	"cancelled",
	"executed",
	"execution-failed",
	"observed"
]);
const failureSchema = z.object({
	code: nonempty,
	message: nonempty
});
const usageSchema = z.object({
	inputTokens: z.number().int().nonnegative().optional(),
	outputTokens: z.number().int().nonnegative().optional()
});
const networkSchema = z.object({
	id: nonempty,
	questionIds: z.array(nonempty).min(1),
	requestBody: jsonSchema,
	startedAt: nonempty,
	dispatchedAt: nonempty.optional(),
	settledAt: nonempty.optional(),
	status: z.enum([
		"pending",
		"succeeded",
		"failed"
	]),
	httpStatus: z.number().int().optional(),
	rawResponseText: z.string().optional(),
	rawResponse: jsonSchema.optional(),
	returnedModel: z.string().optional(),
	requestId: z.string().optional(),
	usage: usageSchema.optional(),
	failure: failureSchema.optional()
});
const attemptSchema = z.object({
	id: nonempty,
	startedAt: nonempty,
	settledAt: nonempty.optional(),
	latencyMs: z.number().nonnegative().optional(),
	connection: z.object({
		baseUrl: z.string().refine((value) => {
			if (value === "") return true;
			try {
				const url = new URL(value);
				return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password && !url.search && !url.hash;
			} catch {
				return false;
			}
		}),
		model: z.string(),
		credentialRef: z.string().regex(/^(?:$|[A-Za-z_][A-Za-z0-9_]*)$/),
		connectionId: z.enum([
			"jev",
			"luna-openrouter",
			"luna-openai"
		]).optional()
	}),
	request: requestSchema,
	status: statusSchema,
	rawResponse: jsonSchema.optional(),
	response: z.object({ answers: z.array(answerSchema) }).optional(),
	interpretation: z.object({
		usable: z.boolean(),
		reason: z.string().optional()
	}).optional(),
	failure: failureSchema.optional(),
	usage: usageSchema.optional(),
	networkRecords: z.array(networkSchema).optional(),
	usageComplete: z.boolean().optional()
});
const detailSchema = z.object({
	id: nonempty,
	featureId: nonempty,
	sessionId: nonempty.optional(),
	status: statusSchema,
	startedAt: nonempty,
	updatedAt: nonempty,
	attempts: z.number().int().nonnegative(),
	actionStatus: actionStatusSchema.optional(),
	diagnostic: z.boolean(),
	link: z.object({
		sessionId: nonempty.optional(),
		runId: nonempty.optional(),
		stepId: nonempty.optional(),
		inputVersion: nonempty.optional()
	}),
	attemptRecords: z.array(attemptSchema),
	failure: z.object({
		code: nonempty,
		message: nonempty
	}).optional(),
	receipts: z.array(z.object({
		id: nonempty,
		status: actionStatusSchema,
		reason: z.string().optional(),
		at: nonempty
	}))
}).superRefine((detail, issue) => {
	if (detail.attempts !== detail.attemptRecords.length) issue.addIssue({
		code: "custom",
		message: "attempt count does not match records"
	});
	for (const attempt of detail.attemptRecords) {
		if (attempt.status !== "succeeded") continue;
		if (attempt.rawResponse === void 0 && attempt.networkRecords === void 0 || attempt.response === void 0) {
			issue.addIssue({
				code: "custom",
				message: "successful attempt lacks response"
			});
			continue;
		}
		try {
			const response = attempt.networkRecords === void 0 ? parseProtocolResponse(attempt.rawResponse, attempt.request, attempt.connection.connectionId).response : replayNetworkResponses(attempt.request, attempt.networkRecords, attempt.connection.connectionId ?? "jev");
			if (JSON.stringify(response) !== JSON.stringify(attempt.response)) issue.addIssue({
				code: "custom",
				message: "stored response differs from raw answer"
			});
			if (attempt.networkRecords !== void 0) {
				if (attempt.networkRecords.some((record) => !isRecord(record.requestBody) || record.requestBody.model !== attempt.connection.model)) throw new Error("Network model differs from connection");
				if (attempt.rawResponse !== void 0 && (attempt.networkRecords.length !== 1 || JSON.stringify(attempt.rawResponse) !== JSON.stringify(attempt.networkRecords[0]?.rawResponse))) throw new Error("Attempt raw response differs from network response");
				const aggregate = aggregateUsage(attempt.networkRecords, true);
				if (JSON.stringify(aggregate.usage) !== JSON.stringify(attempt.usage) || aggregate.usageComplete !== attempt.usageComplete) throw new Error("Attempt usage differs from network usage");
			}
		} catch {
			issue.addIssue({
				code: "custom",
				message: "successful attempt has invalid raw answer"
			});
		}
	}
});
/** Profile directory identity is part of the domain name even when a backend is shared. */
function ledgerSpec(profileDir) {
	return defineDomain({
		name: `jev_${createHash("sha256").update(profileDir).digest("hex").slice(0, 20)}`,
		version: 1,
		layout: "per-record",
		tables: { operations: domainTable(detailSchema) }
	});
}
/** Every mutator awaits the domain's durable write before returning a record to a caller. */
var JevLedger = class JevLedger {
	domain;
	constructor(domain) {
		this.domain = domain;
	}
	static async open(facility, profileDir) {
		const ledger = new JevLedger(await facility.open(ledgerSpec(profileDir)));
		await ledger.markInterrupted();
		return ledger;
	}
	async close() {
		await this.domain.close();
	}
	/** Mark calls and waits left by an earlier Host process as interrupted. */
	async markInterrupted() {
		for (const [id, value] of this.domain.table("operations").entries()) if (value.status === "pending" || value.status === "waiting") await this.domain.table("operations").update(id, (current) => ({
			...current,
			status: "interrupted",
			updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
			attemptRecords: current.attemptRecords.map((attempt) => attempt.status === "pending" || attempt.status === "waiting" ? {
				...attempt,
				status: "interrupted"
			} : attempt)
		}));
		else if (!value.diagnostic && value.status === "succeeded" && value.receipts.length === 0 && value.actionStatus !== "unconfirmed") await this.domain.table("operations").update(id, (current) => ({
			...current,
			actionStatus: "unconfirmed",
			updatedAt: (/* @__PURE__ */ new Date()).toISOString()
		}));
	}
	async create(featureId, link, diagnostic = false) {
		const at = (/* @__PURE__ */ new Date()).toISOString();
		const detail = {
			id: randomUUID(),
			featureId,
			link,
			...link.sessionId === void 0 ? {} : { sessionId: link.sessionId },
			diagnostic,
			status: "pending",
			startedAt: at,
			updatedAt: at,
			attempts: 0,
			attemptRecords: [],
			receipts: []
		};
		await this.domain.table("operations").put(detail.id, detail);
		return detail;
	}
	/** Record a rules-only result without inventing a model attempt or usage. */
	async createRuleObservation(featureId, link) {
		const at = (/* @__PURE__ */ new Date()).toISOString();
		const detail = {
			id: randomUUID(),
			featureId,
			link,
			...link.sessionId === void 0 ? {} : { sessionId: link.sessionId },
			diagnostic: false,
			status: "succeeded",
			startedAt: at,
			updatedAt: at,
			attempts: 0,
			attemptRecords: [],
			receipts: []
		};
		await this.domain.table("operations").put(detail.id, detail);
		return detail;
	}
	/** Write one stable zero-attempt recovery record in a single durable operation. */
	async createInterrupted(featureId, link) {
		const id = "interrupted-" + createHash("sha256").update(JSON.stringify([
			featureId,
			link.sessionId,
			link.inputVersion
		])).digest("hex");
		const existing = this.get(id);
		if (existing !== null) return existing;
		const at = (/* @__PURE__ */ new Date()).toISOString();
		const detail = {
			id,
			featureId,
			link,
			sessionId: link.sessionId,
			diagnostic: false,
			status: "interrupted",
			startedAt: at,
			updatedAt: at,
			attempts: 0,
			attemptRecords: [],
			receipts: [],
			failure: {
				code: "INTERRUPTED",
				message: "Jev operation was interrupted before delivery; no request was resumed"
			}
		};
		await this.domain.table("operations").put(id, detail);
		return detail;
	}
	get(id) {
		return this.domain.table("operations").get(id) ?? null;
	}
	async startAttempt(operationId, request, connection) {
		const attempt = {
			id: randomUUID(),
			request,
			connection,
			status: "pending",
			startedAt: (/* @__PURE__ */ new Date()).toISOString()
		};
		await this.domain.table("operations").update(operationId, (current) => ({
			...current,
			status: "pending",
			updatedAt: attempt.startedAt,
			attempts: current.attemptRecords.length + 1,
			attemptRecords: [...current.attemptRecords, attempt]
		}));
		return attempt;
	}
	/** Persist each network input before dispatch and each response before the next batch. */
	async saveNetwork(operationId, attemptId, networkRecords) {
		await this.domain.table("operations").update(operationId, (current) => ({
			...current,
			attemptRecords: current.attemptRecords.map((attempt) => attempt.id === attemptId ? {
				...attempt,
				networkRecords
			} : attempt)
		}));
	}
	async settleAttempt(operationId, attemptId, patch) {
		const at = (/* @__PURE__ */ new Date()).toISOString();
		await this.domain.table("operations").update(operationId, (current) => {
			if (!current.attemptRecords.some((attempt) => attempt.id === attemptId)) throw new Error("Jev attempt not found");
			return {
				...current,
				status: patch.status,
				updatedAt: at,
				attemptRecords: current.attemptRecords.map((attempt) => attempt.id === attemptId ? {
					...attempt,
					...patch,
					settledAt: at,
					latencyMs: Date.now() - Date.parse(attempt.startedAt)
				} : attempt)
			};
		});
	}
	async setStatus(operationId, status) {
		await this.domain.table("operations").update(operationId, (current) => ({
			...current,
			status,
			updatedAt: (/* @__PURE__ */ new Date()).toISOString()
		}));
	}
	/** Preserve a pre-attempt or ledger-stage failure without inventing an HTTP attempt. */
	async failOperation(operationId, failure) {
		await this.domain.table("operations").update(operationId, (current) => ({
			...current,
			status: "failed",
			failure,
			updatedAt: (/* @__PURE__ */ new Date()).toISOString()
		}));
	}
	/** Explain a settled, unusable operation without inventing an action or model attempt. */
	async noteFailure(operationId, failure) {
		await this.domain.table("operations").update(operationId, (current) => {
			if (current.status !== "failed" && current.status !== "cancelled") throw new Error("Jev operation is not failed or cancelled");
			return {
				...current,
				failure,
				updatedAt: (/* @__PURE__ */ new Date()).toISOString()
			};
		});
	}
	async receipt(operationId, receipt) {
		return this.domain.table("operations").update(operationId, (current) => {
			if (current.status !== "succeeded") throw new Error("Jev action receipt requires a successful judgment");
			if (receipt.status === "unconfirmed") throw new Error("Jev action receipt cannot declare an unconfirmed status");
			const previous = current.receipts.find((item) => item.id === receipt.id);
			if (previous !== void 0) {
				if (JSON.stringify(previous) !== JSON.stringify(receipt)) throw new Error("Jev action receipt conflicts with existing id");
				return current;
			}
			return {
				...current,
				actionStatus: receipt.status,
				updatedAt: receipt.at,
				receipts: [...current.receipts, receipt]
			};
		});
	}
	list(filter) {
		const limit = filter.limit === void 0 ? 25 : Math.max(1, Math.min(100, Math.trunc(filter.limit)));
		const rows = [...this.domain.table("operations").entries()].map(([, row]) => row).filter((row) => (filter.featureId === void 0 || row.featureId === filter.featureId) && (filter.status === void 0 || row.status === filter.status) && (filter.sessionId === void 0 || row.sessionId === filter.sessionId)).sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id));
		const cursorIndex = filter.cursor === void 0 ? -1 : rows.findIndex((row) => row.id === filter.cursor);
		if (filter.cursor !== void 0 && cursorIndex < 0) throw new Error("Jev record cursor does not match this query");
		const start = cursorIndex + 1;
		const selected = rows.slice(start, start + limit);
		return {
			items: selected.map(({ link: _link, attemptRecords: _attemptRecords, receipts: _receipts, ...summary }) => summary),
			...start + limit < rows.length ? { nextCursor: selected.at(-1)?.id } : {}
		};
	}
};
//#endregion
//#region packages/jev/lib/types/types.js
/** Public Jev judgment, operation, and safe Remote data types. */
/** Resolve the explicitly selected protocol; custom URLs do not change its identity. */
function resolveConnectionIdentity(values, id) {
	const connectionId = id ?? (values.judgmentModel === "luna" ? `luna-${values.lunaApi}` : "jev");
	const baseUrl = connectionId === "jev" ? values.baseUrl : connectionId === "luna-openrouter" ? values.lunaOpenRouterBaseUrl : values.lunaOpenAIBaseUrl;
	let safeUrl = "";
	try {
		const url = new URL(baseUrl.trim());
		if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password && !url.search && !url.hash) safeUrl = url.toString();
	} catch {}
	return {
		connectionId,
		baseUrl: safeUrl,
		model: connectionId === "jev" ? values.model.trim() : connectionId === "luna-openrouter" ? "openai/gpt-6-luna-decisions" : "gpt-6-luna",
		credentialRef: (connectionId === "jev" ? values.credentialRef : connectionId === "luna-openrouter" ? values.lunaOpenRouterCredentialRef : values.lunaOpenAICredentialRef).trim(),
		timeoutMs: values.timeoutMs
	};
}
//#endregion
//#region packages/jev/lib/types/index.js
/** Jev common Host service and typed consumer API. */
var __runInitializers = function(thisArg, initializers, value) {
	var useValue = arguments.length > 2;
	for (var i = 0; i < initializers.length; i++) value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
	return useValue ? value : void 0;
};
var __esDecorate = function(ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
	function accept(f) {
		if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected");
		return f;
	}
	var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
	var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
	var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
	var _, done = false;
	for (var i = decorators.length - 1; i >= 0; i--) {
		var context = {};
		for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
		for (var p in contextIn.access) context.access[p] = contextIn.access[p];
		context.addInitializer = function(f) {
			if (done) throw new TypeError("Cannot add initializers after decoration has completed");
			extraInitializers.push(accept(f || null));
		};
		var result = (0, decorators[i])(kind === "accessor" ? {
			get: descriptor.get,
			set: descriptor.set
		} : descriptor[key], context);
		if (kind === "accessor") {
			if (result === void 0) continue;
			if (result === null || typeof result !== "object") throw new TypeError("Object expected");
			if (_ = accept(result.get)) descriptor.get = _;
			if (_ = accept(result.set)) descriptor.set = _;
			if (_ = accept(result.init)) initializers.unshift(_);
		} else if (_ = accept(result)) if (kind === "field") initializers.unshift(_);
		else descriptor[key] = _;
	}
	if (target) Object.defineProperty(target, contextIn.name, descriptor);
	done = true;
};
/** Stable failure code without provider payload or credential text. */
var JevError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.code = code;
		this.name = "JevError";
	}
};
const PROBE = {
	state: { diagnostic: "jev-connection-test" },
	questions: [
		{
			id: "route",
			kind: "choice",
			prompt: "Choose the diagnostic option.",
			options: [{
				id: "left",
				description: "Diagnostic option left"
			}, {
				id: "right",
				description: "Diagnostic option right"
			}]
		},
		{
			id: "risk",
			kind: "score",
			prompt: "Score this fixed diagnostic on the supplied levels.",
			levels: [
				"low",
				"medium",
				"high"
			]
		},
		{
			id: "ready",
			kind: "noul",
			prompt: "Is this a fixed connection diagnostic?"
		}
	]
};
/** Validated live configuration presented through DSH settings. */
const Config = s.object({
	baseUrl: s.string().pattern(/^(?:$|https?:\/\/(?:\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+)(?::[0-9]{1,5})?(?:\/[^?#\s]*)?)$/).default("").volatile(),
	model: s.string().pattern(/^[^\s]+$/).default("jev-latest").volatile(),
	credentialRef: s.string().pattern(/^[A-Za-z_][A-Za-z0-9_]*$/).default("JEV_API_KEY").volatile(),
	timeoutMs: s.number().step(1).min(1).max(3e5).default(1e4).volatile(),
	features: s.dict(s.boolean()).default({}).volatile(),
	judgmentModel: s.union(["jev", "luna"]).default("jev").volatile(),
	lunaApi: s.union(["openrouter", "openai"]).default("openrouter").volatile(),
	lunaOpenRouterBaseUrl: s.string().pattern(/^(?:$|https?:\/\/(?:\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+)(?::[0-9]{1,5})?(?:\/[^?#\s]*)?)$/).default("https://openrouter.ai/api/alpha/decisions").volatile(),
	lunaOpenRouterCredentialRef: s.string().pattern(/^[A-Za-z_][A-Za-z0-9_]*$/).default("JEV_LUNA_OPENROUTER_API_KEY").volatile(),
	lunaOpenAIBaseUrl: s.string().pattern(/^(?:$|https?:\/\/(?:\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+)(?::[0-9]{1,5})?(?:\/[^?#\s]*)?)$/).default("https://api.openai.com/v1/decisions").volatile(),
	lunaOpenAICredentialRef: s.string().pattern(/^[A-Za-z_][A-Za-z0-9_]*$/).default("JEV_LUNA_OPENAI_API_KEY").volatile()
});
function safeFailure(error) {
	if (error instanceof JevError) return {
		code: error.code,
		message: error.message
	};
	if (error instanceof Error && "code" in error && typeof error.code === "string") {
		const code = error.code;
		if ([
			"AUTH",
			"PAYMENT_REQUIRED",
			"RATE_LIMIT",
			"SERVER",
			"BAD_REQUEST",
			"NETWORK",
			"ABORTED",
			"TIMEOUT",
			"REFUSAL",
			"INVALID_RESPONSE",
			"FEATURE_DISABLED"
		].includes(code)) return {
			code,
			message: `Jev ${code.toLowerCase().replaceAll("_", " ")}`
		};
	}
	return {
		code: "SERVICE_FAILURE",
		message: "Jev request failed"
	};
}
/** One profile's public judgment service and browser Remote namespace. */
let JevService = (() => {
	let _classSuper = TypertRemoteService;
	let _instanceExtraInitializers = [];
	let _listFeatures_decorators;
	let _listRecords_decorators;
	let _getRecord_decorators;
	let _getStageNavigation_decorators;
	let _startStageAnalysis_decorators;
	let _cancelStageAnalysis_decorators;
	let _getStageAnalysisRecord_decorators;
	let _getCredentialStatus_decorators;
	let _setCredential_decorators;
	let _testConnection_decorators;
	return class JevService extends _classSuper {
		static {
			const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
			_listFeatures_decorators = [Remote("listFeatures")];
			_listRecords_decorators = [Remote("listRecords")];
			_getRecord_decorators = [Remote("getRecord")];
			_getStageNavigation_decorators = [Remote("getStageNavigation")];
			_startStageAnalysis_decorators = [Remote("startStageAnalysis")];
			_cancelStageAnalysis_decorators = [Remote("cancelStageAnalysis")];
			_getStageAnalysisRecord_decorators = [Remote("getStageAnalysisRecord")];
			_getCredentialStatus_decorators = [Remote("getCredentialStatus")];
			_setCredential_decorators = [Remote("setCredential")];
			_testConnection_decorators = [Remote("testConnection")];
			__esDecorate(this, null, _listFeatures_decorators, {
				kind: "method",
				name: "listFeatures",
				static: false,
				private: false,
				access: {
					has: (obj) => "listFeatures" in obj,
					get: (obj) => obj.listFeatures
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _listRecords_decorators, {
				kind: "method",
				name: "listRecords",
				static: false,
				private: false,
				access: {
					has: (obj) => "listRecords" in obj,
					get: (obj) => obj.listRecords
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _getRecord_decorators, {
				kind: "method",
				name: "getRecord",
				static: false,
				private: false,
				access: {
					has: (obj) => "getRecord" in obj,
					get: (obj) => obj.getRecord
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _getStageNavigation_decorators, {
				kind: "method",
				name: "getStageNavigation",
				static: false,
				private: false,
				access: {
					has: (obj) => "getStageNavigation" in obj,
					get: (obj) => obj.getStageNavigation
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _startStageAnalysis_decorators, {
				kind: "method",
				name: "startStageAnalysis",
				static: false,
				private: false,
				access: {
					has: (obj) => "startStageAnalysis" in obj,
					get: (obj) => obj.startStageAnalysis
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _cancelStageAnalysis_decorators, {
				kind: "method",
				name: "cancelStageAnalysis",
				static: false,
				private: false,
				access: {
					has: (obj) => "cancelStageAnalysis" in obj,
					get: (obj) => obj.cancelStageAnalysis
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _getStageAnalysisRecord_decorators, {
				kind: "method",
				name: "getStageAnalysisRecord",
				static: false,
				private: false,
				access: {
					has: (obj) => "getStageAnalysisRecord" in obj,
					get: (obj) => obj.getStageAnalysisRecord
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _getCredentialStatus_decorators, {
				kind: "method",
				name: "getCredentialStatus",
				static: false,
				private: false,
				access: {
					has: (obj) => "getCredentialStatus" in obj,
					get: (obj) => obj.getCredentialStatus
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _setCredential_decorators, {
				kind: "method",
				name: "setCredential",
				static: false,
				private: false,
				access: {
					has: (obj) => "setCredential" in obj,
					get: (obj) => obj.setCredential
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _testConnection_decorators, {
				kind: "method",
				name: "testConnection",
				static: false,
				private: false,
				access: {
					has: (obj) => "testConnection" in obj,
					get: (obj) => obj.testConnection
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			if (_metadata) Object.defineProperty(this, Symbol.metadata, {
				enumerable: true,
				configurable: true,
				writable: true,
				value: _metadata
			});
		}
		config = __runInitializers(this, _instanceExtraInitializers);
		static inject = [
			"llm",
			"credentials",
			"storageDomain",
			"userQuestions",
			"profileContext",
			"settings"
		];
		static Config = Config;
		adapter = new JevAdapter();
		features = /* @__PURE__ */ new Map();
		ledger;
		active = /* @__PURE__ */ new Set();
		controllers = /* @__PURE__ */ new Set();
		disposing = false;
		featureListeners = /* @__PURE__ */ new Set();
		stageNavigation;
		constructor(ctx, config) {
			super(ctx, "jev");
			this.config = config;
		}
		async [Service.init]() {
			this.ledger = await JevLedger.open(this.ctx.storageDomain, this.ctx.profileContext.dir);
			this.ctx.effect(() => async () => {
				this.disposing = true;
				for (const controller of this.controllers) controller.abort();
				await Promise.allSettled([...this.active]);
				await this.ledger?.close();
			}, "jev.ledger");
			this.ctx.effect(() => this.ctx.llm.registerAdapter([JEV_PROVIDER], this.adapter), "jev.adapter");
			this.ctx.effect(() => this.ctx.settings.configure({ auto: false }, this.ctx.fiber), "jev.settings");
			let features = JSON.stringify(this.config.features.get());
			this.ctx.on("loader/volatile-update", () => {
				const next = this.config.features.get();
				const identity = JSON.stringify(next);
				if (identity === features) return;
				features = identity;
				const snapshot = Object.freeze({ ...next });
				for (const listener of this.featureListeners) listener(snapshot);
			});
		}
		records() {
			if (this.ledger === void 0) throw new JevError("UNAVAILABLE", "Jev service is unavailable");
			return this.ledger;
		}
		/** Register a consumer feature for this Host lifetime; the caller owns the disposer. */
		registerFeature(feature) {
			if (!/^[a-z][a-z0-9-]*$/.test(feature.id) || !feature.name.trim() || !feature.description.trim()) throw new JevError("INVALID_FEATURE", "Jev feature identity and description are required");
			if (this.features.has(feature.id)) throw new JevError("DUPLICATE_FEATURE", `Jev feature ${feature.id} is already registered`);
			this.features.set(feature.id, feature);
			return () => {
				if (this.features.get(feature.id) === feature) this.features.delete(feature.id);
			};
		}
		/** Current registrations, with unknown and newly registered ids disabled by default. */
		async listFeatures() {
			const enabled = this.config.features.get();
			return [...this.features.values()].map((feature) => ({
				...feature,
				enabled: enabled[feature.id] === true
			}));
		}
		/** Query only the current profile, with bounded page size and optional filters. */
		async listRecords(filter) {
			if (filter.limit !== void 0 && (!Number.isSafeInteger(filter.limit) || filter.limit < 1 || filter.limit > 100)) throw new JevError("INVALID_FILTER", "Jev record limit must be between 1 and 100");
			return this.records().list(filter);
		}
		/** Read one current-profile operation after the list has identified it. */
		async getRecord(id) {
			return this.records().get(id);
		}
		/** Bind the optional Host stage consumer while its plugin row is active. */
		registerStageNavigation(manager) {
			if (this.stageNavigation !== void 0) throw new JevError("DUPLICATE_FEATURE", "Stage navigation is already registered");
			this.stageNavigation = manager;
			return () => {
				if (this.stageNavigation === manager) this.stageNavigation = void 0;
			};
		}
		stages() {
			if (this.stageNavigation === void 0) throw new JevError("UNAVAILABLE", "Stage navigation is unavailable");
			return this.stageNavigation;
		}
		/** Read one complete authorized Session cut and its auxiliary stage results. */
		getStageNavigation(sessionId, signal) {
			return this.stages().read(sessionId, signal);
		}
		/** Start only a user-requested batch; returning does not await model calls. */
		startStageAnalysis(request) {
			return this.stages().start(request);
		}
		/** Cancel auxiliary requests without cancelling the native Agent. */
		cancelStageAnalysis(batchId) {
			return this.stages().cancel(batchId);
		}
		/** Load exact persisted input and raw Jev answer for one selected step. */
		getStageAnalysisRecord(sessionId, stepId, recordId) {
			return this.stages().detail(sessionId, stepId, recordId);
		}
		/** Report credential presence, source, and writability without its value. */
		async getCredentialStatus(connection) {
			const identity = this.savedConnection(connection);
			const info = await this.ctx.credentials.describe(credentialRef(identity.credentialRef));
			return {
				connection: identity,
				configured: info.configured,
				writable: info.writable,
				...info.source === void 0 ? {} : { source: info.source }
			};
		}
		/** Save or replace the current profile's configured credential reference. */
		async setCredential(connection, value) {
			if (value.trim().length === 0) throw new JevError("INVALID_CREDENTIAL", "Jev key must not be blank");
			const identity = this.savedConnection(connection);
			await this.ctx.credentials.set(credentialRef(identity.credentialRef), value.trim());
			const info = await this.ctx.credentials.describe(credentialRef(identity.credentialRef));
			return {
				connection: identity,
				configured: info.configured,
				writable: info.writable,
				...info.source === void 0 ? {} : { source: info.source }
			};
		}
		/** Run one fixed diagnostic without a business feature or user state. */
		async testConnection(connection, signal) {
			const identity = this.savedConnection(connection, true);
			return this.runActive(signal, async (lifetime) => {
				const started = Date.now();
				const operation = await this.records().create("diagnostic", {}, true);
				try {
					const result = await this.tryOnce(operation.id, PROBE, void 0, lifetime, void 0, identity);
					if (lifetime.aborted) await this.records().setStatus(operation.id, "cancelled");
					return {
						ok: result.ok,
						latencyMs: Date.now() - started,
						recordId: operation.id,
						connection: identity,
						...result.ok ? {} : { failure: result.failure }
					};
				} catch (error) {
					if (!(error instanceof JevError && error.code === "LOG_WRITE_FAILED")) await this.records().setStatus(operation.id, lifetime.aborted ? "cancelled" : "failed");
					throw error;
				}
			});
		}
		/** Judge one dependent operation; only a human retry invokes `refresh` again. */
		judge(options) {
			return this.runActive(options.signal, (lifetime) => this.judgeOwned(options, lifetime));
		}
		/** Make one logged attempt without human waiting or automatic retry. Only `ok` permits adoption. */
		judgeOnce(options) {
			return this.runActive(options.signal, async (lifetime) => {
				let operationId;
				try {
					if (!this.features.has(options.featureId)) throw new JevError("UNKNOWN_FEATURE", "Jev feature is not registered");
					if (!this.isEnabled(options.featureId)) throw new JevError("FEATURE_DISABLED", "Jev feature is disabled");
					const operation = await this.records().create(options.featureId, options.link);
					operationId = operation.id;
					if (lifetime.aborted) return this.cancel(operation.id);
					const request = await this.untilAbort(Promise.resolve(options.refresh(lifetime)), lifetime);
					validateRequest(request);
					const attempted = await this.tryOnce(operation.id, request, options.interpret, lifetime, options.featureId, options.connection);
					if (lifetime.aborted) return this.cancel(operation.id);
					if (!attempted.ok) return {
						kind: "failed",
						operationId,
						failure: attempted.failure
					};
					const current = options.canAdopt === void 0 ? true : await this.untilAbort(Promise.resolve(options.canAdopt(attempted.response, lifetime)), lifetime);
					if (lifetime.aborted) return this.cancel(operation.id);
					if (current !== true) {
						const reason = current || "Target is no longer current";
						await this.writeReceipt(operation.id, {
							id: "not-adopted",
							status: "not-adopted",
							reason,
							at: (/* @__PURE__ */ new Date()).toISOString()
						});
						return {
							kind: "not-adopted",
							operationId,
							reason
						};
					}
					return {
						kind: "ok",
						operationId,
						attemptId: attempted.attemptId,
						response: attempted.response
					};
				} catch (error) {
					const code = error instanceof JevError && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code) ? error.code : "SERVICE_FAILURE";
					const failure = {
						code,
						message: "Jev " + code.toLowerCase().replaceAll("_", " ")
					};
					if (operationId !== void 0) try {
						if (lifetime.aborted) await this.records().setStatus(operationId, "cancelled");
						else await this.records().failOperation(operationId, failure);
					} catch {}
					if (lifetime.aborted && operationId !== void 0) return {
						kind: "cancelled",
						operationId
					};
					return {
						kind: "failed",
						...operationId === void 0 ? {} : { operationId },
						failure
					};
				}
			}).catch((error) => ({
				kind: "failed",
				failure: safeFailure(error)
			}));
		}
		runActive(outer, execute) {
			if (this.disposing) return Promise.reject(new JevError("UNAVAILABLE", "Jev service is stopping"));
			const controller = new AbortController();
			this.controllers.add(controller);
			const task = execute(outer === void 0 ? controller.signal : AbortSignal.any([controller.signal, outer])).finally(() => {
				this.controllers.delete(controller);
				this.active.delete(task);
			});
			this.active.add(task);
			return task;
		}
		async untilAbort(work, signal) {
			if (signal.aborted) throw new JevError("CANCELLED", "Jev operation was cancelled");
			return new Promise((resolve, reject) => {
				const onAbort = () => {
					signal.removeEventListener("abort", onAbort);
					reject(new JevError("CANCELLED", "Jev operation was cancelled"));
				};
				signal.addEventListener("abort", onAbort, { once: true });
				work.then((value) => {
					signal.removeEventListener("abort", onAbort);
					resolve(value);
				}, (error) => {
					signal.removeEventListener("abort", onAbort);
					reject(error);
				});
			});
		}
		async judgeOwned(options, lifetime) {
			if (!this.features.has(options.featureId)) throw new JevError("UNKNOWN_FEATURE", "Jev feature is not registered");
			if (!this.isEnabled(options.featureId)) throw new JevError("FEATURE_DISABLED", "Jev feature is disabled");
			if (this.disposing) throw new JevError("UNAVAILABLE", "Jev service is stopping");
			const operation = await this.records().create(options.featureId, options.link);
			try {
				for (;;) {
					if (lifetime.aborted) return this.cancel(operation.id);
					if (!this.isEnabled(options.featureId)) {
						if (await this.ask(options.agent, lifetime, "Jev feature is disabled. Enable it to retry or cancel.") === "cancel") return this.cancel(operation.id);
						continue;
					}
					const request = await this.untilAbort(Promise.resolve(options.refresh(lifetime)), lifetime);
					validateRequest(request);
					const attempted = await this.tryOnce(operation.id, request, options.interpret, lifetime, options.featureId);
					if (lifetime.aborted) return this.cancel(operation.id);
					if (attempted.ok) {
						if (options.canAdopt !== void 0) {
							const current = await this.untilAbort(Promise.resolve(options.canAdopt(attempted.response, lifetime)), lifetime);
							if (lifetime.aborted) return this.cancel(operation.id);
							if (current !== true) {
								const reason = current || "Target is no longer current";
								await this.writeReceipt(operation.id, {
									id: "not-adopted",
									status: "not-adopted",
									reason,
									at: (/* @__PURE__ */ new Date()).toISOString()
								});
								return {
									kind: "not-adopted",
									operationId: operation.id,
									reason
								};
							}
						}
						return {
							kind: "ok",
							operationId: operation.id,
							attemptId: attempted.attemptId,
							response: attempted.response
						};
					}
					await this.records().setStatus(operation.id, "waiting");
					if (await this.ask(options.agent, lifetime, `${attempted.failure.message}. Retry with current input or cancel?`) === "cancel") return this.cancel(operation.id);
				}
			} catch (error) {
				if (!(error instanceof JevError && (error.code === "LOG_WRITE_FAILED" || error.code === "RECEIPT_NOT_SAVED"))) await this.records().setStatus(operation.id, lifetime.aborted ? "cancelled" : "failed");
				if (lifetime.aborted) return {
					kind: "cancelled",
					operationId: operation.id
				};
				throw error;
			}
		}
		async cancel(operationId) {
			await this.records().setStatus(operationId, "cancelled");
			return {
				kind: "cancelled",
				operationId
			};
		}
		isEnabled(id) {
			return this.isFeatureEnabled(id);
		}
		/** Read this profile's current enablement synchronously; absent feature ids are disabled. */
		isFeatureEnabled(featureId) {
			return this.config.features.get()[featureId] === true;
		}
		/** Observe committed feature-setting changes synchronously; the consumer owns the disposer. */
		onFeatureStateChange(listener) {
			this.featureListeners.add(listener);
			return () => {
				this.featureListeners.delete(listener);
			};
		}
		async ask(agent, signal, detail) {
			try {
				const choice = (await this.untilAbort(this.ctx.userQuestions.ask({
					agent,
					signal,
					questions: [{
						id: "jev-resolution",
						question: "Jev 判断需要您的决定 / Jev judgment needs your decision",
						detail: `${detail}\n失败后不会自动继续。请选择重试或取消。 / Jev will not continue automatically. Choose retry or cancel.`,
						options: [{ label: "重试 / Retry" }, { label: "取消 / Cancel" }]
					}]
				}), signal)).answers.find((item) => item.id === "jev-resolution");
				if (choice?.selected.length !== 1 || (choice.custom ?? "").trim() !== "") throw new JevError("INVALID_HUMAN_ANSWER", "Jev needs an explicit Retry or Cancel selection");
				const [selected] = choice.selected;
				if (selected === "重试 / Retry" || selected === "重试" || selected === "Retry") return "retry";
				if (selected === "取消 / Cancel" || selected === "取消" || selected === "Cancel") return "cancel";
				throw new JevError("INVALID_HUMAN_ANSWER", "Jev needs an explicit Retry or Cancel selection");
			} catch (error) {
				if (signal.aborted) throw new JevError("CANCELLED", "Jev operation was cancelled");
				if (error instanceof JevError) throw error;
				throw new JevError("NO_INTERFACE", "Jev requires an available Web question interface to continue");
			}
		}
		configValues() {
			return {
				baseUrl: this.config.baseUrl.get(),
				model: this.config.model.get(),
				credentialRef: this.config.credentialRef.get(),
				timeoutMs: this.config.timeoutMs.get(),
				features: this.config.features.get(),
				judgmentModel: this.config.judgmentModel.get(),
				lunaApi: this.config.lunaApi.get(),
				lunaOpenRouterBaseUrl: this.config.lunaOpenRouterBaseUrl.get(),
				lunaOpenRouterCredentialRef: this.config.lunaOpenRouterCredentialRef.get(),
				lunaOpenAIBaseUrl: this.config.lunaOpenAIBaseUrl.get(),
				lunaOpenAICredentialRef: this.config.lunaOpenAICredentialRef.get()
			};
		}
		connectionIdentity(id) {
			return resolveConnectionIdentity(this.configValues(), id);
		}
		savedConnection(expected, active = false) {
			if (![
				"jev",
				"luna-openrouter",
				"luna-openai"
			].includes(expected.connectionId)) throw new JevError("CONNECTION_CHANGED", "Refresh the saved judgment connection");
			const identity = this.connectionIdentity(active ? void 0 : expected.connectionId);
			if (expected.connectionId !== identity.connectionId || expected.baseUrl !== identity.baseUrl || expected.model !== identity.model || expected.credentialRef !== identity.credentialRef || expected.timeoutMs !== identity.timeoutMs) throw new JevError("CONNECTION_CHANGED", "The saved judgment connection changed; refresh before continuing");
			return identity;
		}
		/** Stable non-secret connection settings used to decide whether an old stage result is current. */
		stageConnectionIdentity() {
			const { connectionId, ...legacy } = this.connectionIdentity();
			return connectionId === "jev" ? legacy : {
				...legacy,
				connectionId
			};
		}
		/** All saved references must be checked before historical input is released to a provider. */
		stageConnections() {
			return [
				"jev",
				"luna-openrouter",
				"luna-openai"
			].map((id) => this.connectionIdentity(id));
		}
		/** Current saved connection without authentication values. */
		judgmentConnectionIdentity() {
			return this.connectionIdentity();
		}
		async tryOnce(operationId, request, interpret, outerSignal, featureId, expectedConnection) {
			let snapshot;
			try {
				snapshot = JSON.parse(JSON.stringify(request));
				validateRequest(snapshot);
			} catch {
				throw new JevError("INVALID_INPUT", "Jev request must contain valid JSON state and questions");
			}
			const identity = expectedConnection === void 0 ? this.connectionIdentity() : this.savedConnection(expectedConnection, true);
			const attempt = await this.records().startAttempt(operationId, snapshot, {
				baseUrl: identity.baseUrl,
				model: identity.model,
				credentialRef: identity.credentialRef,
				connectionId: identity.connectionId
			}).catch(() => {
				throw new JevError("LOG_WRITE_FAILED", "Jev input could not be saved; no request was sent");
			});
			let rawResponse;
			let response;
			let networkRecords = [];
			let usage;
			let usageComplete = false;
			const timeout = AbortSignal.timeout(identity.timeoutMs);
			const signal = AbortSignal.any([timeout, ...outerSignal === void 0 ? [] : [outerSignal]]);
			try {
				if (!identity.baseUrl || !identity.model || !identity.credentialRef) throw new JevError("CONNECTION_MISSING", "Jev service address, model, or credential reference is missing");
				const key = await this.untilAbort(this.ctx.credentials.resolve(credentialRef(identity.credentialRef)), signal);
				if (key === void 0) throw new JevError("CREDENTIAL_MISSING", "Jev credential is not configured");
				const connection = {
					...identity,
					apiKey: key.value
				};
				const issued = this.adapter.issue(snapshot, connection, featureId === void 0 ? void 0 : () => this.isEnabled(featureId), (records) => this.records().saveNetwork(operationId, attempt.id, records));
				networkRecords = issued.records;
				try {
					let text;
					let finished = false;
					for await (const chunk of this.ctx.llm.stream({
						provider: JEV_PROVIDER,
						model: identity.model,
						messages: [{
							role: "user",
							content: [{
								type: "text",
								text: issued.envelope
							}]
						}],
						signal
					})) {
						if (chunk.type === "block-end" && chunk.block.type === "text") text = chunk.block.text;
						if (chunk.type === "finish") {
							finished = true;
							if (chunk.reason.kind === "error" || chunk.reason.kind === "aborted") throw new JevError(outerSignal?.aborted ? "CANCELLED" : timeout.aborted ? "TIMEOUT" : chunk.reason.failure.code, outerSignal?.aborted ? "Jev operation was cancelled" : timeout.aborted ? "Jev request timed out" : "Jev request failed");
							if (chunk.reason.kind !== "stop") throw new JevError("INVALID_RESPONSE", "Jev did not complete a typed answer");
						}
					}
					if (!finished || text === void 0) throw new JevError("INVALID_RESPONSE", "Jev returned no answer");
					try {
						response = replayNetworkResponses(snapshot, networkRecords, identity.connectionId);
						rawResponse = networkRecords.length === 1 ? networkRecords[0]?.rawResponse : void 0;
						const aggregated = aggregateUsage(networkRecords, true);
						usage = aggregated.usage;
						usageComplete = aggregated.usageComplete;
					} catch {
						throw new JevError("INVALID_RESPONSE", "Jev answer failed complete type validation");
					}
				} finally {
					issued.release();
				}
				if (outerSignal?.aborted) throw new JevError("CANCELLED", "Jev operation was cancelled");
				const interpretation = interpret === void 0 ? { usable: true } : await this.untilAbort(Promise.resolve(interpret(response, outerSignal ?? signal)), outerSignal ?? signal);
				if (!interpretation.usable) {
					await this.records().settleAttempt(operationId, attempt.id, {
						status: "failed",
						rawResponse,
						response,
						usage,
						usageComplete,
						networkRecords,
						interpretation,
						failure: {
							code: "UNDETERMINED",
							message: interpretation.reason
						}
					}).catch(() => {
						throw new JevError("LOG_WRITE_FAILED", "Jev result could not be saved");
					});
					return {
						ok: false,
						failure: {
							code: "UNDETERMINED",
							message: interpretation.reason
						}
					};
				}
				if (outerSignal?.aborted) throw new JevError("CANCELLED", "Jev operation was cancelled");
				await this.records().settleAttempt(operationId, attempt.id, {
					status: "succeeded",
					rawResponse,
					response,
					usage,
					usageComplete,
					networkRecords,
					interpretation
				}).catch(() => {
					throw new JevError("LOG_WRITE_FAILED", "Jev result could not be saved");
				});
				return {
					ok: true,
					attemptId: attempt.id,
					response
				};
			} catch (error) {
				if (error instanceof JevError && error.code === "LOG_WRITE_FAILED") throw error;
				const failure = outerSignal?.aborted ? {
					code: "CANCELLED",
					message: "Jev operation was cancelled"
				} : timeout.aborted ? {
					code: "TIMEOUT",
					message: "Jev request timed out"
				} : safeFailure(error);
				rawResponse = networkRecords.length === 1 ? networkRecords[0]?.rawResponse : void 0;
				const expectedPackets = identity.connectionId === "luna-openrouter" ? Math.ceil(snapshot.questions.length / 200) : 1;
				const receivedAll = networkRecords.length === expectedPackets && networkRecords.every((record) => record.dispatchedAt !== void 0 && record.rawResponseText !== void 0);
				const aggregate = aggregateUsage(networkRecords, receivedAll);
				usage = aggregate.usage;
				usageComplete = aggregate.usageComplete;
				await this.records().settleAttempt(operationId, attempt.id, {
					status: failure.code === "CANCELLED" ? "cancelled" : "failed",
					...rawResponse === void 0 ? {} : { rawResponse },
					...usage === void 0 ? {} : { usage },
					usageComplete,
					networkRecords,
					failure
				}).catch(() => {
					throw new JevError("LOG_WRITE_FAILED", "Jev result could not be saved");
				});
				return {
					ok: false,
					failure
				};
			}
		}
		/** Record interrupted input without a model call, human question, or attempt; stable message links are idempotent. */
		recordInterrupted(featureId, link) {
			return this.runActive(void 0, async () => {
				if (!this.features.has(featureId)) throw new JevError("UNKNOWN_FEATURE", "Jev feature is not registered");
				if (!link.sessionId?.trim() || !link.inputVersion?.trim()) throw new JevError("INVALID_LINK", "Interrupted records require a session and input identity");
				return this.records().createInterrupted(featureId, link);
			});
		}
		/** Record one rules-only candidate result with zero model attempts. */
		recordRuleObservation(featureId, link) {
			return this.runActive(void 0, async () => {
				if (!this.features.has(featureId)) throw new JevError("UNKNOWN_FEATURE", "Jev feature is not registered");
				return this.records().createRuleObservation(featureId, link);
			});
		}
		/** Attach a consumer fallback reason to an already failed or cancelled operation. */
		async noteFailure(operationId, code, message) {
			if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(code) || !message.trim()) throw new JevError("INVALID_NOTE", "A failure code and reason are required");
			await this.records().noteFailure(operationId, {
				code,
				message
			});
		}
		/** Persist one action receipt; a failed write leaves execution status unconfirmed. */
		async writeReceipt(operationId, receipt) {
			if (this.records().get(operationId) === null) throw new JevError("UNKNOWN_OPERATION", "Jev operation is not in this profile");
			try {
				return await this.records().receipt(operationId, receipt);
			} catch (error) {
				if (error instanceof Error && error.message.includes("conflicts")) throw new JevError("RECEIPT_CONFLICT", "Jev action receipt id already has different facts");
				throw new JevError("RECEIPT_NOT_SAVED", "Jev action receipt was not saved; do not repeat the action");
			}
		}
	};
})();
//#endregion
export { JEV_PROVIDER as i, JevError as n, JevService as r, Config as t };
