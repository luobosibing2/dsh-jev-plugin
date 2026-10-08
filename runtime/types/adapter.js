/** Dedicated System One adapter used only by JevService's typed one-shot calls. */
import { randomUUID } from 'node:crypto';
import { LlmAdapter, LlmError, attributionHeaders } from '@deepseek-ai/dsh-llm';
import { DecisionResponseError, isJson, knownUsage, parseProtocolResponse, protocolBody, validateRequest } from "./wire.js";
export const JEV_PROVIDER = 'jev-system-one';
/** The adapter never advertises a chat model and rejects calls lacking a service-issued nonce. */
export class JevAdapter extends LlmAdapter {
    pending = new Map();
    issue(request, connection, canStart, record) {
        const nonce = randomUUID();
        const records = [];
        this.pending.set(nonce, { request, connection, canStart, record, records });
        return {
            envelope: JSON.stringify({ version: 1, nonce, state: request.state, questions: request.questions }),
            records,
            release: () => { this.pending.delete(nonce); },
        };
    }
    async *stream(options) {
        const { nonce, request } = this.envelope(options);
        const call = this.pending.get(nonce);
        if (call === undefined || options.model !== call.connection.model
            || JSON.stringify(request) !== JSON.stringify(call.request)) {
            throw new LlmError('Jev accepts only issued typed judgments', 'UNSUPPORTED_OPTION');
        }
        const { connection } = call;
        const limit = connection.connectionId === 'luna-openrouter' ? 200 : request.questions.length;
        for (let offset = 0; offset < request.questions.length; offset += limit) {
            if (options.signal?.aborted)
                throw new LlmError('Decision request was cancelled or timed out', 'ABORTED');
            if (call.canStart?.() === false)
                throw new LlmError('Decision feature was disabled before dispatch', 'FEATURE_DISABLED');
            const part = { state: request.state, questions: request.questions.slice(offset, offset + limit) };
            const exchange = { id: randomUUID(), questionIds: part.questions.map(question => question.id),
                requestBody: protocolBody(connection.connectionId, connection.model, part), startedAt: new Date().toISOString(), status: 'pending' };
            call.records.push(exchange);
            await this.save(call);
            try {
                if (options.signal?.aborted)
                    throw new LlmError('Decision request was cancelled or timed out', 'ABORTED');
                if (call.canStart?.() === false)
                    throw new LlmError('Decision feature was disabled before dispatch', 'FEATURE_DISABLED');
                exchange.dispatchedAt = new Date().toISOString();
                await this.exchange(exchange, part, connection, options.signal);
                exchange.status = 'succeeded';
            }
            catch (error) {
                exchange.status = 'failed';
                const code = error instanceof LlmError ? error.code : 'INVALID_RESPONSE';
                exchange.failure = { code, message: 'Decision network request failed' };
                throw error;
            }
            finally {
                exchange.settledAt = new Date().toISOString();
                await this.save(call);
            }
        }
        const text = JSON.stringify(call.records.map(record => record.rawResponse));
        yield { type: 'block-start', index: 0, blockType: 'text' };
        yield { type: 'text-delta', index: 0, text };
        yield { type: 'block-end', index: 0, block: { type: 'text', text } };
        yield { type: 'finish', reason: { kind: 'stop' } };
    }
    async save(call) {
        try {
            await call.record?.(call.records);
        }
        catch (error) {
            throw new LlmError('Decision network record could not be saved', 'LOG_WRITE_FAILED', { cause: error });
        }
    }
    async exchange(exchange, part, connection, signal) {
        const response = await fetch(connection.baseUrl, {
            method: 'POST',
            headers: {
                ...attributionHeaders(),
                authorization: `Bearer ${connection.apiKey}`,
                'content-type': 'application/json',
                accept: 'application/json',
            },
            body: JSON.stringify(exchange.requestBody),
            signal,
            redirect: 'error',
        }).catch(error => {
            if (signal?.aborted)
                throw new LlmError('Jev request was cancelled or timed out', 'ABORTED');
            throw new LlmError('Jev service could not be reached', 'NETWORK', { cause: error });
        });
        exchange.httpStatus = response.status;
        const requestId = response.headers.get('x-request-id');
        if (requestId !== null)
            exchange.requestId = requestId;
        const raw = await response.text().catch(error => {
            throw new LlmError('Decision response could not be read', signal?.aborted ? 'ABORTED' : 'NETWORK', { cause: error });
        });
        if (raw.length > 2_000_000)
            throw new LlmError('Jev response exceeds 2 MB', 'INVALID_RESPONSE');
        exchange.rawResponseText = raw;
        try {
            const parsed = JSON.parse(raw);
            if (isJson(parsed)) {
                exchange.rawResponse = parsed;
                exchange.usage = knownUsage(parsed);
                if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
                    if ('model' in parsed && typeof parsed.model === 'string')
                        exchange.returnedModel = parsed.model;
                    if (exchange.requestId === undefined && 'id' in parsed && typeof parsed.id === 'string')
                        exchange.requestId = parsed.id;
                }
            }
        }
        catch { /* The original body remains available even when it is not finite JSON. */ }
        if (!response.ok) {
            const code = response.status === 401 || response.status === 403 ? 'AUTH'
                : response.status === 402 ? 'PAYMENT_REQUIRED'
                    : response.status === 429 ? 'RATE_LIMIT'
                        : response.status >= 500 ? 'SERVER' : 'BAD_REQUEST';
            throw new LlmError(`Jev service returned HTTP ${response.status}`, code, { status: response.status });
        }
        try {
            parseProtocolResponse(exchange.rawResponse, part, connection.connectionId);
        }
        catch (error) {
            throw new LlmError('Decision answer failed complete type validation', error instanceof DecisionResponseError ? error.code : 'INVALID_RESPONSE');
        }
    }
    envelope(options) {
        if (options.provider !== JEV_PROVIDER || options.system !== undefined || options.tools !== undefined
            || options.temperature !== undefined || options.stop !== undefined || options.maxTokens !== undefined
            || options.reasoningEffort !== undefined || options.messages.length !== 1) {
            throw new LlmError('Jev is not a chat model', 'UNSUPPORTED_OPTION');
        }
        const message = options.messages[0];
        const content = message?.role === 'user' ? message.content : undefined;
        if (!Array.isArray(content) || content.length !== 1 || content[0]?.type !== 'text') {
            throw new LlmError('Jev accepts only issued typed judgments', 'UNSUPPORTED_OPTION');
        }
        let raw;
        try {
            raw = JSON.parse(content[0].text);
        }
        catch {
            throw new LlmError('Jev typed request envelope is invalid', 'UNSUPPORTED_OPTION');
        }
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)
            || !('version' in raw) || raw.version !== 1
            || !('nonce' in raw) || typeof raw.nonce !== 'string'
            || !('state' in raw) || !('questions' in raw)) {
            throw new LlmError('Jev typed request envelope is invalid', 'UNSUPPORTED_OPTION');
        }
        const request = { state: raw.state, questions: raw.questions };
        try {
            validateRequest(request);
        }
        catch {
            throw new LlmError('Jev typed request envelope is invalid', 'UNSUPPORTED_OPTION');
        }
        return { nonce: raw.nonce, request };
    }
}
//# sourceMappingURL=adapter.js.map