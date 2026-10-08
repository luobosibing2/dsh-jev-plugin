function record(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** A parsed response may contain overflowing numbers, including in nested metadata. */
export function isJson(value) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean')
        return true;
    if (typeof value === 'number')
        return Number.isFinite(value);
    if (Array.isArray(value))
        return value.every(isJson);
    return record(value) && Object.values(value).every(isJson);
}
function input(value) {
    return typeof value === 'string' || (isJson(value) && value !== null && typeof value === 'object');
}
function probability(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}
/** Reject invalid questions before a ledger write or model call. */
export function validateRequest(request) {
    if (!isJson(request.state))
        throw new TypeError('Jev state must be JSON');
    if (!Array.isArray(request.questions) || request.questions.length === 0)
        throw new TypeError('Jev needs at least one question');
    const ids = new Set();
    for (const question of request.questions) {
        if (typeof question.id !== 'string' || question.id.length === 0 || ids.has(question.id)) {
            throw new TypeError('Jev question ids must be nonempty and unique');
        }
        ids.add(question.id);
        if (!input(question.prompt))
            throw new TypeError(`Jev question ${question.id} needs JSON instructions`);
        switch (question.kind) {
            case 'choice': {
                if (!Array.isArray(question.options) || question.options.length === 0)
                    throw new TypeError(`Jev choice ${question.id} needs options`);
                const choices = new Set();
                for (const option of question.options) {
                    if (typeof option.id !== 'string' || option.id.length === 0 || choices.has(option.id)
                        || (option.description !== null && !input(option.description))) {
                        throw new TypeError(`Jev choice ${question.id} has an invalid option`);
                    }
                    choices.add(option.id);
                }
                break;
            }
            case 'score':
                if (!Array.isArray(question.levels) || question.levels.length < 2 || question.levels.length > 10
                    || question.levels.some((level) => level !== null && !input(level))) {
                    throw new TypeError(`Jev score ${question.id} needs 2 to 10 ordered levels`);
                }
                break;
            case 'noul':
                if (question.criteria !== undefined && Object.values(question.criteria).some(value => value !== null && value !== undefined && !input(value))) {
                    throw new TypeError(`Jev noul ${question.id} has invalid criteria`);
                }
                break;
            default:
                throw new TypeError(`Jev question ${question.id} has unsupported kind`);
        }
    }
}
/** Encode the typed public request into the provider's System One HTTP body. */
export function wireBody(model, request) {
    validateRequest(request);
    const questions = Object.fromEntries(request.questions.map(question => [question.id, wireQuestion(question)]));
    return { model, state: request.state, questions };
}
function wireQuestion(question) {
    switch (question.kind) {
        case 'choice': return {
            type: 'choice', instructions: question.prompt,
            criteria: Object.fromEntries(question.options.map(option => [option.id, option.description])),
        };
        case 'score': return { type: 'score', instructions: question.prompt, criteria: question.levels };
        case 'noul': return {
            type: 'noul', instructions: question.prompt,
            ...question.criteria === undefined ? {} : { criteria: question.criteria },
        };
    }
}
/** Parse every answer, including optional probabilities and service signals, or reject the whole request. */
export function parseWireResponse(raw, request) {
    if (!isJson(raw) || !record(raw) || !record(raw.answers))
        throw new TypeError('Jev response has no answers object');
    const answers = raw.answers;
    if (Object.keys(answers).length !== request.questions.length)
        throw new TypeError('Jev response has missing or extra answers');
    const parsed = [];
    for (const question of request.questions) {
        const value = answers[question.id];
        if (!record(value))
            throw new TypeError(`Jev answer ${question.id} is missing`);
        if (value.type === 'refusal' || value.refusal !== undefined)
            throw new DecisionResponseError('REFUSAL', 'Decision provider refused a question');
        if (value.type !== undefined && value.type !== question.kind) {
            throw new TypeError(`Jev answer ${question.id} has the wrong type`);
        }
        const confidence = value.confidence;
        if (confidence !== undefined && !probability(confidence))
            throw new TypeError(`Jev answer ${question.id} has invalid confidence`);
        const signals = {
            ...confidence === undefined ? {} : { confidence },
            ...value.legend === undefined ? {} : { legend: value.legend },
        };
        if (question.kind === 'choice') {
            if (typeof value.choice !== 'string' || !question.options.some(option => option.id === value.choice)) {
                throw new TypeError(`Jev choice ${question.id} picked an unknown option`);
            }
            const probabilities = parseProbabilities(value.probabilities, question.options.map(option => option.id), question.id);
            parsed.push({ id: question.id, kind: 'choice', optionId: value.choice, ...probabilities === undefined ? {} : { probabilities }, ...signals });
        }
        else if (question.kind === 'score') {
            if (typeof value.score !== 'number' || !Number.isFinite(value.score) || value.score < 0 || value.score > question.levels.length - 1) {
                throw new TypeError(`Jev score ${question.id} is outside its rubric`);
            }
            const probabilities = parseProbabilities(value.probabilities, question.levels.map((_, index) => String(index)), question.id);
            parsed.push({ id: question.id, kind: 'score', value: value.score, ...probabilities === undefined ? {} : { probabilities }, ...signals });
        }
        else {
            if (!probability(value.noul))
                throw new TypeError(`Jev noul ${question.id} has invalid probability`);
            parsed.push({ id: question.id, kind: 'noul', probability: value.noul, ...signals });
        }
    }
    const usage = parseUsage(raw);
    return { response: { answers: parsed }, ...usage === undefined ? {} : { usage }, raw };
}
/** A provider rejection is a failed attempt, never a business answer. */
export class DecisionResponseError extends TypeError {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
function text(value) { return typeof value === 'string' ? value : JSON.stringify(value); }
/** Encode complete business input for the explicitly selected Decisions protocol. */
export function protocolBody(connectionId, model, request) {
    if (connectionId === 'jev')
        return wireBody(model, request);
    if (connectionId === 'luna-openrouter') {
        validateRequest(request);
        return { model, state: typeof request.state === 'string' || request.state !== null && typeof request.state === 'object'
                ? request.state : JSON.stringify(request.state), questions: Object.fromEntries(request.questions.map(question => {
                if (question.kind === 'score')
                    return [question.id, { type: 'score', instructions: question.prompt, criteria: question.levels.map(level => level ?? '') }];
                if (question.kind === 'noul' && question.criteria !== undefined
                    && (question.criteria.true === null || question.criteria.true === undefined || question.criteria.false === null || question.criteria.false === undefined)) {
                    return [question.id, { type: 'noul', instructions: { instructions: question.prompt, criteria: question.criteria } }];
                }
                return [question.id, wireQuestion(question)];
            })) };
    }
    validateRequest(request);
    return { model, input: text(request.state), questions: request.questions.map(question => {
            const common = { name: question.id, instructions: text(question.prompt) };
            switch (question.kind) {
                case 'choice': return { ...common, type: 'choice', choices: question.options.map(option => ({
                        value: option.id, ...option.description === null || option.description === '' ? {} : { description: text(option.description) },
                    })) };
                case 'score': return { ...common, type: 'score', levels: question.levels.map((level, index) => ({
                        label: String(index), ...level === null || level === '' ? {} : { description: text(level) },
                    })) };
                case 'noul': return { ...common, type: 'predicate', instructions: question.criteria === undefined
                        ? common.instructions : JSON.stringify({ instructions: question.prompt, criteria: question.criteria }) };
            }
        }) };
}
/** Read known counts independently of answer validation so refusals retain usage. */
export function knownUsage(raw) {
    if (!record(raw) || !record(raw.usage))
        return undefined;
    const inputTokens = raw.usage.input_tokens;
    const outputTokens = raw.usage.output_tokens;
    const count = (value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
    if (!count(inputTokens) && !count(outputTokens))
        return undefined;
    return { ...count(inputTokens) ? { inputTokens } : {}, ...count(outputTokens) ? { outputTokens } : {} };
}
function parseUsage(raw) {
    if (raw.usage === undefined || raw.usage === null)
        return undefined;
    if (!record(raw.usage))
        throw new TypeError('Decision usage is invalid');
    for (const key of ['input_tokens', 'output_tokens']) {
        const value = raw.usage[key];
        if (value !== undefined && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0))
            throw new TypeError('Decision usage count is invalid');
    }
    return knownUsage(raw) ?? {};
}
function nativeProbabilities(value, question) {
    if (!Array.isArray(value))
        throw new TypeError('Decision probabilities are missing');
    const allowed = question.kind === 'choice' ? question.options.map(option => option.id) : question.levels.map((_, index) => String(index));
    const result = {};
    for (const item of value) {
        if (!record(item) || !probability(item.probability)
            || (question.kind === 'choice' ? typeof item.value !== 'string' : typeof item.value !== 'number' || !Number.isInteger(item.value) || typeof item.label !== 'string')) {
            throw new TypeError('Decision probability item is invalid');
        }
        const key = String(item.value);
        if (!allowed.includes(key) || Object.hasOwn(result, key))
            throw new TypeError('Decision probability identity is invalid');
        Object.defineProperty(result, key, { value: item.probability, enumerable: true, configurable: true, writable: true });
    }
    if (Object.keys(result).length !== allowed.length)
        throw new TypeError('Decision probabilities are incomplete');
    return Object.fromEntries(allowed.map(key => [key, result[key]]));
}
/** Decode the provider's original response directly into the existing business answers. */
export function parseProtocolResponse(raw, request, connectionId = 'jev') {
    if (connectionId !== 'luna-openai')
        return parseWireResponse(raw, request);
    if (!isJson(raw) || !record(raw) || !Array.isArray(raw.answers))
        throw new TypeError('Decision response has no answers array');
    if (raw.answers.length !== request.questions.length)
        throw new TypeError('Decision response has missing or extra answers');
    const byName = new Map();
    for (const value of raw.answers) {
        if (!record(value))
            throw new TypeError('Decision answer identity is invalid');
        if (value.type === 'refusal')
            throw new DecisionResponseError('REFUSAL', 'Decision provider refused a question');
        if (typeof value.name !== 'string' || byName.has(value.name))
            throw new TypeError('Decision answer identity is invalid');
        byName.set(value.name, value);
    }
    const answers = request.questions.map(question => {
        const value = byName.get(question.id);
        if (value === undefined || value.type !== (question.kind === 'noul' ? 'predicate' : question.kind))
            throw new TypeError('Decision answer type or identity is invalid');
        if (value.confidence !== undefined && !probability(value.confidence))
            throw new TypeError('Decision confidence is invalid');
        const signals = { ...value.confidence === undefined ? {} : { confidence: value.confidence },
            ...value.legend === undefined ? {} : { legend: value.legend } };
        if (question.kind === 'noul') {
            if (!probability(value.probability))
                throw new TypeError('Decision predicate probability is invalid');
            return { id: question.id, kind: 'noul', probability: value.probability, ...signals };
        }
        if (!probability(value.confidence))
            throw new TypeError('Decision confidence is missing');
        const probabilities = nativeProbabilities(value.probabilities, question);
        if (question.kind === 'choice') {
            if (typeof value.choice !== 'string' || !question.options.some(option => option.id === value.choice))
                throw new TypeError('Decision choice is unknown');
            return { id: question.id, kind: 'choice', optionId: value.choice, probabilities, ...signals };
        }
        if (typeof value.score !== 'number' || !Number.isFinite(value.score) || value.score < 0 || value.score > question.levels.length - 1)
            throw new TypeError('Decision score is outside its rubric');
        return { id: question.id, kind: 'score', value: value.score, probabilities, ...signals };
    });
    const usage = parseUsage(raw);
    return { response: { answers }, raw, ...usage === undefined ? {} : { usage } };
}
/** Reconstruct one complete attempt from its actual network responses in original question order. */
export function replayNetworkResponses(request, records, connectionId) {
    const answers = new Map();
    for (const exchange of records) {
        if (exchange.status !== 'succeeded' || exchange.rawResponse === undefined)
            throw new TypeError('Decision network request did not succeed');
        const questions = exchange.questionIds.map(id => {
            const question = request.questions.find(item => item.id === id);
            if (question === undefined || answers.has(id))
                throw new TypeError('Decision network question identity is invalid');
            return question;
        });
        if (new Set(exchange.questionIds).size !== exchange.questionIds.length)
            throw new TypeError('Decision network question identity is duplicated');
        const part = { state: request.state, questions };
        if (JSON.stringify(protocolBody(connectionId, exchange.requestBody.model ?? '', part)) !== JSON.stringify(exchange.requestBody))
            throw new TypeError('Decision network input differs from business input');
        if (exchange.rawResponseText !== undefined && JSON.stringify(JSON.parse(exchange.rawResponseText)) !== JSON.stringify(exchange.rawResponse))
            throw new TypeError('Decision raw response differs from original text');
        for (const answer of parseProtocolResponse(exchange.rawResponse, part, connectionId).response.answers)
            answers.set(answer.id, answer);
    }
    if (answers.size !== request.questions.length)
        throw new TypeError('Decision network answers are incomplete');
    return { answers: request.questions.map(question => answers.get(question.id)) };
}
/** Sum only observed counts; completeness requires every expected request and both counts. */
export function aggregateUsage(records, complete) {
    let inputTokens;
    let outputTokens;
    for (const record of records) {
        if (record.usage?.inputTokens !== undefined)
            inputTokens = (inputTokens ?? 0) + record.usage.inputTokens;
        if (record.usage?.outputTokens !== undefined)
            outputTokens = (outputTokens ?? 0) + record.usage.outputTokens;
    }
    return { ...inputTokens === undefined && outputTokens === undefined ? {} : { usage: { ...inputTokens === undefined ? {} : { inputTokens }, ...outputTokens === undefined ? {} : { outputTokens } } },
        usageComplete: complete && records.length > 0 && records.every(record => record.usage?.inputTokens !== undefined && record.usage.outputTokens !== undefined) };
}
function parseProbabilities(value, allowed, id) {
    if (value === undefined)
        return undefined;
    if (!record(value))
        throw new TypeError(`Jev answer ${id} probabilities are invalid`);
    const allowedSet = new Set(allowed);
    if (Object.keys(value).length !== allowed.length)
        throw new TypeError(`Jev answer ${id} probabilities are incomplete`);
    for (const [key, chance] of Object.entries(value)) {
        if (!allowedSet.has(key) || !probability(chance))
            throw new TypeError(`Jev answer ${id} probabilities are invalid`);
    }
    return value;
}
//# sourceMappingURL=wire.js.map